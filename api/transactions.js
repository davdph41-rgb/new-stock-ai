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

  } catch (error) {
    console.error("TRANSACTIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengambil data transaksi",
      detail: error.message
    });
  }
}
