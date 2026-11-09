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
    const { date } = req.query;

    let stockDays;

    if (date) {
      stockDays = await sql`
        SELECT id, stock_date
        FROM stock_days
        WHERE stock_date = ${date}
        LIMIT 1
      `;
    } else {
      stockDays = await sql`
        SELECT id, stock_date
        FROM stock_days
        ORDER BY stock_date DESC
        LIMIT 1
      `;
    }

    if (stockDays.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Data stok awal tidak ditemukan"
      });
    }

    const stockDayId = stockDays[0].id;

    const items = await sql`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        d.opening_quantity,

        COALESCE(
          SUM(i.quantity) FILTER (
            WHERE t.transaction_type = 'reservation'
          ), 0
        )::INTEGER AS reservation,

        COALESCE(
          SUM(i.quantity) FILTER (
            WHERE t.transaction_type = 'manual_sales'
          ), 0
        )::INTEGER AS manual_sales,

        COALESCE(
          SUM(i.quantity) FILTER (
            WHERE t.transaction_type = 'session_sales'
          ), 0
        )::INTEGER AS session_sales

      FROM stock_day_items d

      JOIN products p
        ON p.id = d.product_id

      LEFT JOIN stock_transactions t
        ON t.stock_day_id = d.stock_day_id

      LEFT JOIN stock_transaction_items i
        ON i.transaction_id = t.id
        AND i.product_id = p.id

      WHERE d.stock_day_id = ${stockDayId}

      GROUP BY
        p.id,
        p.name,
        d.opening_quantity

      ORDER BY p.id
    `;

    const stock = items.map(item => {
      const opening = Number(item.opening_quantity);
      const reservation = Number(item.reservation);
      const manualSales = Number(item.manual_sales);
      const sessionSales = Number(item.session_sales);

      const totalDeduction =
        reservation + manualSales + sessionSales;

      return {
        productId: item.product_id,
        productName: item.product_name,
        openingStock: opening,
        reservation,
        manualSales,
        sessionSales,
        totalDeduction,
        remainingStock: opening - totalDeduction
      };
    });

    return res.status(200).json({
      success: true,
      date: stockDays[0].stock_date,
      totalProducts: stock.length,
      stock
    });

  } catch (error) {
    console.error("STOCK CURRENT ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal menghitung sisa stok",
      detail: error.message
    });
  }
}
