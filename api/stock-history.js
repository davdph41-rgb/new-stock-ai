
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      success: false,
      error: "DATABASE_URL belum ditemukan"
    });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // GET: MEMBACA RIWAYAT STOK
    if (req.method === "GET") {
      const { date, limit } = req.query || {};

      if (
        date &&
        (
          typeof date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date)
        )
      ) {
        return res.status(400).json({
          success: false,
          error: "Format tanggal harus YYYY-MM-DD"
        });
      }

      const historyLimit = Math.min(
        Math.max(Number(limit) || 50, 1),
        200
      );

      let rows;

      if (date) {
        rows = await sql`
          SELECT
            sh.id,
            sh.change_batch_id,
            sh.old_quantity,
            sh.new_quantity,
            sh.changed_at,
            sd.stock_date,
            p.id AS product_id,
            p.name AS product_name
          FROM stock_history sh
          JOIN stock_days sd
            ON sd.id = sh.stock_day_id
          JOIN products p
            ON p.id = sh.product_id
          WHERE sd.stock_date = ${date}::date
          ORDER BY sh.changed_at DESC, sh.id DESC
          LIMIT ${historyLimit}
        `;
      } else {
        rows = await sql`
          SELECT
            sh.id,
            sh.change_batch_id,
            sh.old_quantity,
            sh.new_quantity,
            sh.changed_at,
            sd.stock_date,
            p.id AS product_id,
            p.name AS product_name
          FROM stock_history sh
          JOIN stock_days sd
            ON sd.id = sh.stock_day_id
          JOIN products p
            ON p.id = sh.product_id
          ORDER BY sh.changed_at DESC, sh.id DESC
          LIMIT ${historyLimit}
        `;
      }

      const history = rows.map(row => ({
        id: row.id,
        batchId: row.change_batch_id,
        date: row.stock_date,
        productId: row.product_id,
        productName: row.product_name,
        oldQuantity: row.old_quantity,
        newQuantity: row.new_quantity,
        changedAt: row.changed_at
      }));

      return res.status(200).json({
        success: true,
        total: history.length,
        history
      });
    }

    // POST: MENYIMPAN STOK AWAL DAN RIWAYAT
    if (req.method === "POST") {
      const { date, items } = req.body || {};

      if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return res.status(400).json({
          success: false,
          error: "Format tanggal harus YYYY-MM-DD"
        });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Daftar stok masih kosong."
        });
      }

      const cleanItems = [];
      const usedIds = new Set();

      for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);

        if (
          !Number.isSafeInteger(productId) ||
          productId <= 0 ||
          !Number.isSafeInteger(quantity) ||
          quantity < 0
        ) {
          return res.status(400).json({
            success: false,
            error: "Jumlah stok harus bilangan bulat dan tidak negatif."
          });
        }

        if (usedIds.has(productId)) {
          return res.status(400).json({
            success: false,
            error: "Produk tidak boleh tercatat dua kali."
          });
        }

        usedIds.add(productId);

        cleanItems.push({
          product_id: productId,
          quantity
        });
      }

      const dbProducts = await sql`
        SELECT id
        FROM products
        WHERE active = true
      `;

      const validIds = new Set(
        dbProducts.map(product => String(product.id))
      );

      if (
        cleanItems.length !== validIds.size ||
        cleanItems.some(item =>
          !validIds.has(String(item.product_id))
        )
      ) {
        return res.status(400).json({
          success: false,
          error: "Daftar produk tidak sesuai dengan database."
        });
      }

      const result = await sql`
        WITH

        target_day AS (
          INSERT INTO stock_days (stock_date)
          VALUES (${date}::date)

          ON CONFLICT (stock_date)
          DO UPDATE SET stock_date = EXCLUDED.stock_date

          RETURNING id
        ),

        batch AS (
          SELECT gen_random_uuid() AS batch_id
        ),

        input_items AS (
          SELECT *
          FROM jsonb_to_recordset(
            ${JSON.stringify(cleanItems)}::jsonb
          ) AS x(
            product_id bigint,
            quantity integer
          )
        ),

        previous_items AS MATERIALIZED (
          SELECT
            sdi.stock_day_id,
            sdi.product_id,
            sdi.opening_quantity
          FROM stock_day_items sdi
          JOIN target_day td
            ON td.id = sdi.stock_day_id
          JOIN input_items i
            ON i.product_id = sdi.product_id
          FOR UPDATE OF sdi
        ),

        updated_items AS (
          UPDATE stock_day_items sdi
          SET opening_quantity = i.quantity
          FROM target_day td,
               input_items i,
               previous_items p
          WHERE sdi.stock_day_id = td.id
            AND sdi.product_id = i.product_id
            AND p.stock_day_id = td.id
            AND p.product_id = i.product_id
            AND sdi.opening_quantity IS DISTINCT FROM i.quantity

          RETURNING sdi.product_id
        ),

        inserted_items AS (
          INSERT INTO stock_day_items (
            stock_day_id,
            product_id,
            opening_quantity
          )
          SELECT
            td.id,
            i.product_id,
            i.quantity
          FROM target_day td
          CROSS JOIN input_items i
          WHERE NOT EXISTS (
            SELECT 1
            FROM previous_items p
            WHERE p.product_id = i.product_id
          )

          RETURNING product_id
        ),

        history_rows AS (
          SELECT
            p.stock_day_id,
            p.product_id,
            p.opening_quantity AS old_quantity,
            i.quantity AS new_quantity
          FROM previous_items p
          JOIN input_items i
            ON i.product_id = p.product_id
          JOIN updated_items u
            ON u.product_id = p.product_id

          UNION ALL

          SELECT
            td.id,
            i.product_id,
            0,
            i.quantity
          FROM target_day td
          CROSS JOIN input_items i
          JOIN inserted_items ins
            ON ins.product_id = i.product_id
          WHERE i.quantity > 0
        ),

        history_insert AS (
          INSERT INTO stock_history (
            change_batch_id,
            stock_day_id,
            product_id,
            old_quantity,
            new_quantity
          )
          SELECT
            b.batch_id,
            h.stock_day_id,
            h.product_id,
            h.old_quantity,
            h.new_quantity
          FROM history_rows h
          CROSS JOIN batch b

          RETURNING id
        )

        SELECT
          td.id AS stock_day_id,
          (SELECT COUNT(*) FROM history_insert)::integer
            AS history_count
        FROM target_day td
      `;

      return res.status(200).json({
        success: true,
        message: "Stok awal berhasil disimpan.",
        date,
        stockDayId: result[0]?.stock_day_id,
        historyCount: result[0]?.history_count ?? 0
      });
    }

    return res.status(405).json({
      success: false,
      error: "Method tidak diizinkan"
    });

  } catch (error) {
    console.error("STOCK HISTORY API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Operasi riwayat stok gagal.",
      detail: error.message
    });
  }
}
