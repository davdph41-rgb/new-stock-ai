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

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Tanggal wajib diisi dengan format YYYY-MM-DD"
      });
    }

    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

    const schedules = dayOfWeek === 0 || dayOfWeek === 6
      ? [
          { number: 1, start: "10:00", end: "12:00" },
          { number: 2, start: "12:00", end: "15:00" },
          { number: 3, start: "15:00", end: "17:00" }
        ]
      : [
          { number: 1, start: "12:00", end: "15:00" },
          { number: 2, start: "15:00", end: "17:00" }
        ];

    const stockDays = await sql`
      SELECT id
      FROM stock_days
      WHERE stock_date = ${date}
      LIMIT 1
    `;

    if (stockDays.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Stok awal untuk tanggal tersebut belum tersedia"
      });
    }

    const stockDayId = stockDays[0].id;

    const sessions = await sql`
      SELECT
        session_number,
        start_time,
        end_time,
        status,
        closed_at
      FROM stock_sessions
      WHERE stock_day_id = ${stockDayId}
      ORDER BY session_number
    `;

    const summaries = await sql`
      SELECT
        t.session_number,
        p.id AS product_id,
        p.name AS product_name,
        SUM(i.quantity)::INTEGER AS total_sold
      FROM stock_transactions t
      JOIN stock_transaction_items i
        ON i.transaction_id = t.id
      JOIN products p
        ON p.id = i.product_id
      WHERE t.stock_day_id = ${stockDayId}
        AND t.transaction_type = 'session_sales'
      GROUP BY t.session_number, p.id, p.name
      ORDER BY t.session_number, p.name
    `;

    const result = schedules.map(schedule => {
      const savedSession = sessions.find(
        session => Number(session.session_number) === schedule.number
      );

      const sessionSummary = summaries
        .filter(item => Number(item.session_number) === schedule.number)
        .map(item => ({
          productId: item.product_id,
          productName: item.product_name,
          totalSold: item.total_sold
        }));

      return {
        sessionNumber: schedule.number,
        startTime: schedule.start,
        endTime: schedule.end,
        status: savedSession?.status || "open",
        closedAt: savedSession?.closed_at || null,
        totalProducts: sessionSummary.length,
        summary: sessionSummary
      };
    });

    return res.status(200).json({
      success: true,
      date,
      totalSessions: result.length,
      sessions: result
    });

  } catch (error) {
    console.error("SESSIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Gagal mengambil data sesi",
      detail: error.message
    });
  }
}
