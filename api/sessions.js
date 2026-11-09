
import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({
      success: false,
      error: "DATABASE_URL belum ditemukan"
    });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // GET: MEMBACA STATUS DAN RINGKASAN SESI
    if (req.method === "GET") {
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
          error: "Stok awal belum tersedia"
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
        const saved = sessions.find(
          s => Number(s.session_number) === schedule.number
        );

        const summary = summaries
          .filter(s => Number(s.session_number) === schedule.number)
          .map(s => ({
            productId: s.product_id,
            productName: s.product_name,
            totalSold: s.total_sold
          }));

        return {
          sessionNumber: schedule.number,
          startTime: schedule.start,
          endTime: schedule.end,
          status: saved?.status || "open",
          closedAt: saved?.closed_at || null,
          totalProducts: summary.length,
          summary
        };
      });

      return res.status(200).json({
        success: true,
        date,
        totalSessions: result.length,
        sessions: result
      });
    }

    // POST: MENUTUP DAN MENGUNCI SESI
    if (req.method === "POST") {
      const { date, sessionNumber } = req.body || {};

      if (
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isInteger(Number(sessionNumber))
      ) {
        return res.status(400).json({
          success: false,
          error: "Tanggal atau nomor sesi tidak valid"
        });
      }

      const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();

      const schedules = dayOfWeek === 0 || dayOfWeek === 6
        ? {
            1: ["10:00", "12:00"],
            2: ["12:00", "15:00"],
            3: ["15:00", "17:00"]
          }
        : {
            1: ["12:00", "15:00"],
            2: ["15:00", "17:00"]
          };

      const schedule = schedules[Number(sessionNumber)];

      if (!schedule) {
        return res.status(400).json({
          success: false,
          error: "Nomor sesi tidak tersedia"
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
          error: "Data stok awal tidak ditemukan"
        });
      }

      const stockDayId = stockDays[0].id;

      await sql`
        INSERT INTO stock_sessions (
          stock_day_id,
          session_number,
          start_time,
          end_time,
          status
        )
        VALUES (
          ${stockDayId},
          ${Number(sessionNumber)},
          ${schedule[0]},
          ${schedule[1]},
          'open'
        )
        ON CONFLICT (stock_day_id, session_number)
        DO NOTHING
      `;

      const session = await sql`
        SELECT id, status
        FROM stock_sessions
        WHERE stock_day_id = ${stockDayId}
          AND session_number = ${Number(sessionNumber)}
      `;

      if (session[0].status === "closed") {
        return res.status(409).json({
          success: false,
          error: "Sesi sudah ditutup sebelumnya"
        });
      }

      const summary = await sql`
        SELECT
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
          AND t.session_number = ${Number(sessionNumber)}
        GROUP BY p.id, p.name
        ORDER BY p.name
      `;

      const closed = await sql`
        UPDATE stock_sessions
        SET
          status = 'closed',
          closed_at = NOW()
        WHERE stock_day_id = ${stockDayId}
          AND session_number = ${Number(sessionNumber)}
          AND status = 'open'
        RETURNING id
      `;

      if (closed.length === 0) {
        return res.status(409).json({
          success: false,
          error: "Sesi sudah ditutup"
        });
      }

      return res.status(200).json({
        success: true,
        message: "Sesi berhasil ditutup dan dikunci",
        date,
        sessionNumber: Number(sessionNumber),
        sessionStatus: "closed",
        summary
      });
    }

    return res.status(405).json({
      success: false,
      error: "Method tidak diizinkan"
    });

  } catch (error) {
    console.error("SESSIONS API ERROR:", error);

    return res.status(500).json({
      success: false,
      error: "Operasi sesi gagal",
      detail: error.message
    });
  }
}
