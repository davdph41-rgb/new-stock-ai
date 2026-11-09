
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
    const { date, mode } = req.query || {};

    if (mode && mode !== "current") {
      return res.status(400).json({
        success: false,
        error: "Mode tidak dikenal. Gunakan mode=current"
      });
    }

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Format tanggal harus YYYY-MM-DD"
      });
    }

    // MODE 1: MENGHITUNG STOK TERSISA
    if (mode === "current") {
      let stockDays;

      if (date) {
        stockDays = await sql`
          SELECT id, stock_date
          FROM stock_days
          WHERE stock_date = ${date}::date
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
    }

    // MODE 2: MEMBACA STOK AWAL
    let rows;

    if (date) {
      rows = await sql`
        SELECT
          sd.id AS stock_day_id,
          sd.stock_date,
          sdi.id AS item_id,
          p.id AS product_id,
          p.name AS product_name,
          sdi.opening_quantity
        FROM stock_days sd
        LEFT JOIN stock_day_items sdi
          ON sdi.stock_day_id = sd.id
        LEFT JOIN products p
          ON p.id = sdi.product_id
        WHERE sd.stock_date = ${date}::date
        ORDER BY p.id ASC
      `;
    } else {
      rows = await sql`
        SELECT
          sd.id AS stock_day_id,
          sd.stock_date,
          sdi.id AS item_id,
          p.id AS product_id,
          p.name AS product_name,
          sdi.opening_quantity
        FROM stock_days sd
        LEFT JOIN stock_day_items sdi
          ON sdi.stock_day_id = sd.id
        LEFT JOIN products p
          ON p.id = sdi.product_id
        WHERE sd.stock_date = (
          SELECT MAX(stock_date)
          FROM stock_days
        )
        ORDER BY p.id ASC
      `;
    }

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        stockDay: null,
        totalProducts: 0,
        items: []
      });
    }

    const items = rows
      .filter(row => row.product_id !== null)
      .map(row => ({
        productId: row.product_id,
        name: row.product_name,
        openingQuantity: row.opening_quantity
      }));

    return res.status(200).json({
      success: true,
      stockDay: {
        id: rows[0].stock_day_id,
        date: rows[0].stock_date
      },
      totalProducts: items.length,
      items
    });

  } catch (error) {
    console.error("STOCK API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengambil data stok",
      detail: error.message
    });
  }
}
