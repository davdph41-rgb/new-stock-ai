import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method tidak diizinkan"
    });
  }

  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      success: false,
      error: "DATABASE_URL belum ditemukan"
    });
  }

  try {
    const { date, items } = req.body || {};

    // Validasi tanggal
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return res.status(400).json({
        success: false,
        error: "Format tanggal harus YYYY-MM-DD"
      });
    }

    // Validasi daftar produk
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
          error: "Data produk atau jumlah stok tidak valid."
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

    const sql = neon(process.env.DATABASE_URL);

    // Pastikan semua produk aktif dikirim
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

    // Simpan atau perbarui stok awal.
    // Semua perubahan dilakukan dalam satu perintah SQL.
    const result = await sql`
      WITH existing_day AS (
        SELECT id
        FROM stock_days
        WHERE stock_date = ${date}::date
        LIMIT 1
      ),

      created_day AS (
        INSERT INTO stock_days (stock_date)
        SELECT ${date}::date
        WHERE NOT EXISTS (
          SELECT 1 FROM existing_day
        )
        RETURNING id
      ),

      target_day AS (
        SELECT id FROM existing_day
        UNION ALL
        SELECT id FROM created_day
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

      updated_items AS (
        UPDATE stock_day_items AS sdi
        SET opening_quantity = input_items.quantity
        FROM target_day, input_items
        WHERE sdi.stock_day_id = target_day.id
          AND sdi.product_id = input_items.product_id
        RETURNING sdi.id
      ),

      inserted_items AS (
        INSERT INTO stock_day_items (
          stock_day_id,
          product_id,
          opening_quantity
        )
        SELECT
          target_day.id,
          input_items.product_id,
          input_items.quantity
        FROM target_day
        CROSS JOIN input_items
        WHERE NOT EXISTS (
          SELECT 1
          FROM stock_day_items AS existing
          WHERE existing.stock_day_id = target_day.id
            AND existing.product_id = input_items.product_id
        )
        RETURNING id
      )

      SELECT id FROM target_day
    `;

    return res.status(200).json({
      success: true,
      message: "Stok awal berhasil disimpan.",
      date,
      stockDayId: result[0]?.id
    });

  } catch (error) {
    console.error("Stock Save Error:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal menyimpan stok awal."
    });
  }
}
