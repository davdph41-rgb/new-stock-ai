import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
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

    const { transactionId } = req.body || {};

    if (!Number.isInteger(Number(transactionId)) || Number(transactionId) <= 0) {
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

  } catch (error) {
    console.error("TRANSACTION DELETE ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal menghapus transaksi",
      detail: error.message
    });
  }
}
