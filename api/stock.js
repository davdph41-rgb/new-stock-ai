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
    const date = req.query?.date;

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Format tanggal harus YYYY-MM-DD"
      });
    }

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
    console.error("Stock API Error:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengambil data stok"
    });
  }
}
