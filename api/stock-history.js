import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (req.method !== "GET") {
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

    const { date, limit } = req.query || {};

    // Validasi tanggal
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

    // Batas jumlah riwayat
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

  } catch (error) {
    console.error("Stock History Error:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengambil riwayat stok."
    });
  }
}
