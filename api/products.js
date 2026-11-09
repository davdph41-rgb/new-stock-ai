
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

    const products = await sql`
      SELECT
        id,
        name,
        aliases,
        active,
        created_at
      FROM products
      WHERE active = TRUE
      ORDER BY id ASC
    `;

    return res.status(200).json({
      success: true,
      total: products.length,
      products
    });

  } catch (error) {
    console.error("Products API Error:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengambil data produk"
    });
  }
}
