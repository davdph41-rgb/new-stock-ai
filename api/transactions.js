
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
    // GET: MEMBACA TRANSAKSI
    if (req.method === "GET") {
      const { date } = req.query;
      if (date && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        return res.status(400).json({ success: false, error: "Format tanggal harus YYYY-MM-DD" });
      }

      let transactions;

      if (date) {
        transactions = await sql`
          SELECT
            t.id,
            t.transaction_number,
            t.transaction_type,
            t.stock_day_id,
            t.session_number,
            t.description,
            t.transaction_date,
            t.created_at,
            t.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'productId', p.id,
                  'productName', p.name,
                  'quantity', i.quantity
                )
              ) FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS items
          FROM stock_transactions t
          LEFT JOIN stock_transaction_items i
            ON i.transaction_id = t.id
          LEFT JOIN products p
            ON p.id = i.product_id
          WHERE t.transaction_date = ${date}
          GROUP BY t.id
          ORDER BY t.id DESC
        `;
      } else {
        transactions = await sql`
          SELECT
            t.id,
            t.transaction_number,
            t.transaction_type,
            t.stock_day_id,
            t.session_number,
            t.description,
            t.transaction_date,
            t.created_at,
            t.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'productId', p.id,
                  'productName', p.name,
                  'quantity', i.quantity
                )
              ) FILTER (WHERE i.id IS NOT NULL),
              '[]'
            ) AS items
          FROM stock_transactions t
          LEFT JOIN stock_transaction_items i
            ON i.transaction_id = t.id
          LEFT JOIN products p
            ON p.id = i.product_id
          GROUP BY t.id
          ORDER BY t.id DESC
          LIMIT 100
        `;
      }

      return res.status(200).json({
        success: true,
        total: transactions.length,
        transactions
      });
    }

    // POST: MENYIMPAN TRANSAKSI SECARA UTUH
    if (req.method === "POST") {
      const {
        transactionType,
        date,
        sessionNumber,
        description,
        items,
        requestKey
      } = req.body || {};

      const allowedTypes = ["reservation", "manual_sales", "session_sales"];
      if (
        !allowedTypes.includes(transactionType) ||
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({ success: false, error: "Data transaksi tidak lengkap atau tidak valid" });
      }

      if (
        items.some(item =>
          !Number.isSafeInteger(Number(item.productId)) ||
          !Number.isSafeInteger(Number(item.quantity)) ||
          Number(item.productId) <= 0 ||
          Number(item.quantity) <= 0
        ) ||
        new Set(items.map(item => Number(item.productId))).size !== items.length
      ) {
        return res.status(400).json({ success: false, error: "Produk atau jumlah tidak valid" });
      }

      if (transactionType === "session_sales" && ![1, 2, 3].includes(Number(sessionNumber))) {
        return res.status(400).json({ success: false, error: "Nomor sesi tidak valid" });
      }
      if (transactionType === "session_sales") {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (weekday !== 0 && weekday !== 6 && Number(sessionNumber) === 3) {
          return res.status(400).json({ success: false, error: "Hari kerja hanya memiliki sesi 1 dan sesi 2." });
        }
      }

      const stockDays = await sql`
        SELECT id FROM stock_days WHERE stock_date = ${date}::date LIMIT 1
      `;
      if (stockDays.length === 0) {
        return res.status(404).json({ success: false, error: "Stok awal tanggal tersebut belum tersedia" });
      }
      const stockDayId = stockDays[0].id;

      if (transactionType === "session_sales") {
        const sessions = await sql`
          SELECT status FROM stock_sessions
          WHERE stock_day_id = ${stockDayId}
            AND session_number = ${Number(sessionNumber)}
        `;
        if (sessions.length && sessions[0].status === "closed") {
          return res.status(409).json({ success: false, error: "Sesi sudah ditutup dan dikunci" });
        }
      }

      const productIds = items.map(item => Number(item.productId));
      const products = await sql`
        SELECT id FROM products
        WHERE id = ANY(${productIds}::bigint[]) AND active = true
      `;
      if (products.length !== productIds.length) {
        return res.status(400).json({ success: false, error: "Ada produk yang tidak ditemukan atau tidak aktif" });
      }

      // Kunci duplikat sederhana: key dari isi foto/pesan disimpan di kolom description.
      // Tidak membutuhkan perubahan tabel/database.
      const safeRequestKey = typeof requestKey === "string" && /^[a-f0-9]{64}$/.test(requestKey)
        ? requestKey
        : null;
      const marker = safeRequestKey ? `[STOCKAI:${safeRequestKey}]` : null;

      if (marker) {
        const duplicate = await sql`
          SELECT id, transaction_number
          FROM stock_transactions
          WHERE description LIKE ${`%${marker}%`}
          LIMIT 1
        `;
        if (duplicate.length) {
          return res.status(200).json({
            success: true,
            duplicate: true,
            message: "Pesan atau foto ini sudah pernah dicatat. Tidak ada pengurangan ulang.",
            transaction: {
              id: duplicate[0].id,
              transactionNumber: duplicate[0].transaction_number
            }
          });
        }
      }

      // Pastikan stok masih cukup sebelum menyimpan transaksi.
      const balances = await sql`
        SELECT
          d.product_id,
          p.name AS product_name,
          d.opening_quantity,
          COALESCE(SUM(i.quantity), 0)::integer AS deducted
        FROM stock_day_items d
        JOIN products p ON p.id = d.product_id
        LEFT JOIN stock_transactions t ON t.stock_day_id = d.stock_day_id
        LEFT JOIN stock_transaction_items i
          ON i.transaction_id = t.id AND i.product_id = d.product_id
        WHERE d.stock_day_id = ${stockDayId}
        GROUP BY d.product_id, p.name, d.opening_quantity
      `;

      const shortages = [];
      for (const item of items) {
        const row = balances.find(balance => Number(balance.product_id) === Number(item.productId));
        const available = row ? Number(row.opening_quantity) - Number(row.deducted) : 0;
        if (!row || available < Number(item.quantity)) {
          shortages.push({
            productName: row?.product_name || `Produk #${item.productId}`,
            available,
            requested: Number(item.quantity)
          });
        }
      }
      if (shortages.length) {
        return res.status(409).json({
          success: false,
          error: "Stok tidak mencukupi. Transaksi tidak disimpan.",
          shortages
        });
      }

      const descriptionWithKey = marker
        ? `${marker} ${String(description || "").slice(0, 900)}`
        : (description || null);

      // Satu SQL statement agar transaksi dan seluruh item tersimpan bersama.
      const inserted = await sql`
        WITH input_items AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(items.map(item => ({
            product_id: Number(item.productId),
            quantity: Number(item.quantity)
          })))}::jsonb) AS x(product_id bigint, quantity integer)
        ),
        new_transaction AS (
          INSERT INTO stock_transactions (
            transaction_type, stock_day_id, session_number,
            description, transaction_date
          )
          VALUES (
            ${transactionType},
            ${stockDayId},
            ${transactionType === "session_sales" ? Number(sessionNumber) : null},
            ${descriptionWithKey},
            ${date}::date
          )
          RETURNING id, transaction_number
        ),
        new_items AS (
          INSERT INTO stock_transaction_items (transaction_id, product_id, quantity)
          SELECT nt.id, ii.product_id, ii.quantity
          FROM new_transaction nt CROSS JOIN input_items ii
          RETURNING id
        )
        SELECT nt.id, nt.transaction_number, (SELECT COUNT(*) FROM new_items)::integer AS item_count
        FROM new_transaction nt
      `;

      return res.status(201).json({
        success: true,
        message: "Transaksi berhasil disimpan",
        transaction: {
          id: inserted[0].id,
          transactionNumber: inserted[0].transaction_number,
          transactionType,
          date,
          sessionNumber: transactionType === "session_sales" ? Number(sessionNumber) : null,
          items
        }
      });
    }

    // PUT: MENGEDIT TRANSAKSI
    if (req.method === "PUT") {
      const {
        transactionId,
        transactionType,
        date,
        sessionNumber,
        description,
        items
      } = req.body || {};

      if (
        !Number.isInteger(Number(transactionId)) ||
        Number(transactionId) <= 0 ||
        !date ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Data transaksi tidak lengkap"
        });
      }

      const allowedTypes = [
        "reservation",
        "manual_sales",
        "session_sales"
      ];

      if (!allowedTypes.includes(transactionType)) {
        return res.status(400).json({
          success: false,
          error: "Jenis transaksi tidak valid"
        });
      }

      if (
        items.some(item =>
          !Number.isInteger(Number(item.productId)) ||
          !Number.isInteger(Number(item.quantity)) ||
          Number(item.productId) <= 0 ||
          Number(item.quantity) <= 0
        ) ||
        new Set(items.map(item => Number(item.productId))).size !== items.length
      ) {
        return res.status(400).json({
          success: false,
          error: "Produk atau jumlah tidak valid"
        });
      }

      if (
        transactionType === "session_sales" &&
        ![1, 2, 3].includes(Number(sessionNumber))
      ) {
        return res.status(400).json({
          success: false,
          error: "Nomor sesi tidak valid"
        });
      }

      const existing = await sql`
        SELECT *
        FROM stock_transactions
        WHERE id = ${Number(transactionId)}
      `;

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Transaksi tidak ditemukan"
        });
      }

      const old = existing[0];

      if (old.transaction_type === "session_sales") {
        const oldSession = await sql`
          SELECT status
          FROM stock_sessions
          WHERE stock_day_id = ${old.stock_day_id}
            AND session_number = ${old.session_number}
        `;

        if (oldSession.length > 0 && oldSession[0].status === "closed") {
          return res.status(409).json({
            success: false,
            error: "Transaksi berasal dari sesi yang sudah ditutup"
          });
        }
      }

      const stockDays = await sql`
        SELECT id
        FROM stock_days
        WHERE stock_date = ${date}
        LIMIT 1
      `;

      if (stockDays.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Stok awal tanggal tujuan tidak ditemukan"
        });
      }

      const stockDayId = stockDays[0].id;

      if (transactionType === "session_sales") {
        const targetSession = await sql`
          SELECT status
          FROM stock_sessions
          WHERE stock_day_id = ${stockDayId}
            AND session_number = ${Number(sessionNumber)}
        `;

        if (
          targetSession.length > 0 &&
          targetSession[0].status === "closed"
        ) {
          return res.status(409).json({
            success: false,
            error: "Sesi tujuan sudah ditutup"
          });
        }
      }

      const productIds = items.map(item => Number(item.productId));

      const products = await sql`
        SELECT id
        FROM products
        WHERE id = ANY(${productIds}::bigint[])
          AND active = true
      `;

      if (products.length !== productIds.length) {
        return res.status(400).json({
          success: false,
          error: "Ada produk yang tidak ditemukan atau tidak aktif"
        });
      }

      await sql`
        UPDATE stock_transactions
        SET
          transaction_type = ${transactionType},
          stock_day_id = ${stockDayId},
          session_number = ${
            transactionType === "session_sales"
              ? Number(sessionNumber)
              : null
          },
          description = ${description || null},
          transaction_date = ${date},
          updated_at = NOW()
        WHERE id = ${Number(transactionId)}
      `;

      await sql`
        DELETE FROM stock_transaction_items
        WHERE transaction_id = ${Number(transactionId)}
      `;

      for (const item of items) {
        await sql`
          INSERT INTO stock_transaction_items (
            transaction_id,
            product_id,
            quantity
          )
          VALUES (
            ${Number(transactionId)},
            ${Number(item.productId)},
            ${Number(item.quantity)}
          )
        `;
      }

      return res.status(200).json({
        success: true,
        message: "Transaksi berhasil diperbarui",
        transactionId
      });
    }

    // DELETE: MENGHAPUS TRANSAKSI
    if (req.method === "DELETE") {
      const { transactionId } = req.body || {};

      if (
        !Number.isInteger(Number(transactionId)) ||
        Number(transactionId) <= 0
      ) {
        return res.status(400).json({
          success: false,
          error: "ID transaksi tidak valid"
        });
      }

      const existing = await sql`
        SELECT id, transaction_type, stock_day_id, session_number
        FROM stock_transactions
        WHERE id = ${Number(transactionId)}
      `;

      if (existing.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Transaksi tidak ditemukan"
        });
      }

      const transaction = existing[0];

      if (transaction.transaction_type === "session_sales") {
        const sessions = await sql`
          SELECT status
          FROM stock_sessions
          WHERE stock_day_id = ${transaction.stock_day_id}
            AND session_number = ${transaction.session_number}
        `;

        if (sessions.length > 0 && sessions[0].status === "closed") {
          return res.status(409).json({
            success: false,
            error: "Transaksi berasal dari sesi yang sudah ditutup"
          });
        }
      }

      await sql`
        DELETE FROM stock_transactions
        WHERE id = ${Number(transactionId)}
      `;

      return res.status(200).json({
        success: true,
        message: "Transaksi berhasil dihapus",
        transactionId
      });
    }

    return res.status(405).json({
      success: false,
      error: "Method tidak didukung"
    });

  } catch (error) {
    console.error("TRANSACTIONS API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Operasi transaksi gagal",
      detail: error.message
    });
  }
}
