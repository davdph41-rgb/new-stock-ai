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
    const sql = neon(process.env.DATABASE_URL);

    const {
      transactionType,
      date,
      sessionNumber,
      description,
      items
    } = req.body || {};

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

    if (!date || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Tanggal dan daftar produk wajib diisi"
      });
    }

    if (
      items.some(item =>
        !Number.isInteger(Number(item.productId)) ||
        !Number.isInteger(Number(item.quantity)) ||
        Number(item.quantity) <= 0
      )
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

    const stockDays = await sql`
      SELECT id
      FROM stock_days
      WHERE stock_date = ${date}
      LIMIT 1
    `;

    if (stockDays.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Data stok awal untuk tanggal tersebut belum tersedia"
      });
    }

    const stockDayId = stockDays[0].id;

    if (transactionType === "session_sales") {
      const sessions = await sql`
        SELECT id, status
        FROM stock_sessions
        WHERE stock_day_id = ${stockDayId}
          AND session_number = ${Number(sessionNumber)}
      `;

      if (sessions.length > 0 && sessions[0].status === "closed") {
        return res.status(409).json({
          success: false,
          error: "Sesi sudah ditutup dan dikunci"
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

    if (products.length !== new Set(productIds).size) {
      return res.status(400).json({
        success: false,
        error: "Ada produk yang tidak ditemukan atau tidak aktif"
      });
    }

    const result = await sql`
      INSERT INTO stock_transactions (
        transaction_type,
        stock_day_id,
        session_number,
        description,
        transaction_date
      )
      VALUES (
        ${transactionType},
        ${stockDayId},
        ${transactionType === "session_sales"
          ? Number(sessionNumber)
          : null},
        ${description || null},
        ${date}
      )
      RETURNING id, transaction_number
    `;

    const transactionId = result[0].id;

    for (const item of items) {
      await sql`
        INSERT INTO stock_transaction_items (
          transaction_id,
          product_id,
          quantity
        )
        VALUES (
          ${transactionId},
          ${Number(item.productId)},
          ${Number(item.quantity)}
        )
      `;
    }

    return res.status(201).json({
      success: true,
      message: "Transaksi berhasil disimpan",
      transaction: {
        id: transactionId,
        transactionNumber: result[0].transaction_number,
        transactionType,
        date,
        sessionNumber: sessionNumber || null,
        items
      }
    });

  } catch (error) {
    console.error("TRANSACTION SAVE ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal menyimpan transaksi",
      detail: error.message
    });
  }
}
