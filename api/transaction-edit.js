import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "PUT") {
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
    const sql = neon(process.env.DATABASE_URL);

    const {
      transactionId,
      transactionType,
      date,
      sessionNumber,
      description,
      items
    } = req.body || {};

    if (!transactionId || !date || !Array.isArray(items) || items.length === 0) {
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

    const oldTransaction = existing[0];

    if (oldTransaction.transaction_type === "session_sales") {
      const oldSession = await sql`
        SELECT status
        FROM stock_sessions
        WHERE stock_day_id = ${oldTransaction.stock_day_id}
          AND session_number = ${oldTransaction.session_number}
      `;

      if (oldSession.length > 0 && oldSession[0].status === "closed") {
        return res.status(409).json({
          success: false,
          error: "Transaksi berasal dari sesi yang sudah ditutup"
        });
      }
    }

    if (transactionType === "session_sales") {
      const sessions = await sql`
        SELECT status
        FROM stock_sessions
        WHERE stock_day_id = (
          SELECT id FROM stock_days
          WHERE stock_date = ${date}
        )
          AND session_number = ${Number(sessionNumber)}
      `;

      if (sessions.length > 0 && sessions[0].status === "closed") {
        return res.status(409).json({
          success: false,
          error: "Sesi tujuan sudah ditutup"
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

    const productIds = items.map(item => Number(item.productId));

    const products = await sql`
      SELECT id
      FROM products
      WHERE id = ANY(${productIds}::bigint[])
        AND active = true
    `;

    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({
        success: false,
        error: "Ada produk yang tidak ditemukan atau tidak aktif"
      });
    }

    await sql`
      UPDATE stock_transactions
      SET
        transaction_type = ${transactionType},
        stock_day_id = ${stockDays[0].id},
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

  } catch (error) {
    console.error("TRANSACTION EDIT ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengubah transaksi",
      detail: error.message
    });
  }
}
