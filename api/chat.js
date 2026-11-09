
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method tidak diizinkan."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY belum dikonfigurasi di Vercel."
    });
  }

  try {
    const { messages, image } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Pesan tidak boleh kosong."
      });
    }

    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Jakarta"
    });

    const systemPrompt = `
Kamu adalah STOCK AI, asisten khusus penghitungan stok inventaris.

TANGGAL HARI INI: ${today}

TUGAS UTAMA:
1. Membantu mencatat dan memeriksa stok.
2. Membaca data reservasi.
3. Membaca laporan penjualan sesi 1, sesi 2, dan sesi 3.
4. Mencatat penjualan manual.
5. Membantu merangkum stok.

KAMUS PRODUK:
- Mekencis = Mac n Cheese
- Prawn Mayo = Tempura Shrimp
- French Fries = French Fries SBS
- Beef Burger = Sembodro Beef Burger
- Fish & Chips = Fish n Chips
- Mix Platters = Mix Platers

ATURAN MEMBACA STOK:
- Kamu memiliki fungsi get_stock untuk membaca stok awal dari database Neon.
- Jika pengguna bertanya tentang stok, gunakan fungsi get_stock.
- Jika pengguna menyebut hari ini, gunakan tanggal ${today}.
- Jika pengguna menyebut tanggal tertentu, gunakan tanggal tersebut dalam format YYYY-MM-DD.
- Jangan mengarang data stok.
- Gunakan hanya hasil yang dikembalikan fungsi get_stock.
- Jika data stok tidak ditemukan, jelaskan bahwa data belum tersedia.
- Data yang dibaca saat ini adalah stok awal, bukan stok akhir setelah penjualan.
- Jangan menyebut stok awal sebagai stok akhir.
- Fungsi get_stock hanya untuk membaca. Jangan mengaku telah mengubah atau menyimpan stok.

ATURAN UMUM:
- Gunakan nama inventaris utama.
- Jika nama produk tidak dikenal, tanyakan kepada pengguna.
- Bedakan stok awal, reservasi, penjualan sesi, dan penjualan manual.
- Jangan mencampurkan transaksi dari hari berbeda.
- Jika data tidak jelas, minta konfirmasi.
- Jangan membuat angka atau data yang tidak diberikan pengguna.
- Gunakan bahasa Indonesia yang ringkas dan profesional.

FORMAT JAWABAN:
1. Gunakan Markdown terstruktur.
2. Judul utama gunakan ##.
3. Subjudul gunakan ###.
4. Gunakan **bold** untuk informasi penting.
5. Jika menampilkan beberapa produk, gunakan tabel:
   | Nama Produk | Jumlah |
   |---|---:|
   | French Fries | 10 pcs |
6. Total stok harus ditampilkan jika datanya tersedia.
7. Jangan membuat tabel kosong.
8. Jangan menggunakan terlalu banyak emoji.

Kamu adalah AI khusus stok, bukan asisten umum.
`;

    const contents = messages.slice(-20).map(msg => ({
      role: msg.sender === "ai" ? "model" : "user",
      parts: [{ text: String(msg.text || "") }]
    }));

    if (image) {
      if (
        !image.mimeType?.startsWith("image/") ||
        !image.data ||
        image.data.length > 7_000_000
      ) {
        return res.status(400).json({
          error: "Format atau ukuran gambar tidak valid."
        });
      }

      if (!contents.length) {
        return res.status(400).json({
          error: "Pesan gambar tidak ditemukan."
        });
      }

      contents[contents.length - 1].parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }

    // Menentukan alamat API Stock pada deployment Vercel.
    const host =
      process.env.VERCEL_URL ||
      req.headers["x-forwarded-host"] ||
      req.headers.host;

    const protocol =
      req.headers["x-forwarded-proto"]?.split(",")[0] || "https";

    if (!host) {
      return res.status(500).json({
        error: "Alamat server Stock API tidak ditemukan."
      });
    }

    const stockApiBase = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${protocol}://${host}`;

    // Fungsi yang dapat dipanggil Gemini.
    const tools = [
      {
        function_declarations: [
          {
            name: "get_stock",
            description:
              "Membaca stok awal produk dari database Neon. Gunakan ketika pengguna bertanya tentang stok. Jika tanggal tidak diberikan, gunakan tanggal hari ini.",
            parameters: {
              type: "OBJECT",
              properties: {
                date: {
                  type: "STRING",
                  description:
                    "Tanggal stok dalam format YYYY-MM-DD."
                }
              }
            }
          }
        ]
      }
    ];

    // Memanggil Gemini.
    async function callGemini(currentContents) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
          },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: currentContents,
            tools,
            tool_config: {
              function_calling_config: {
                mode: "AUTO"
              }
            },
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 2048
            }
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("Gemini API error:", result);
        throw new Error(
          result.error?.message || "Gemini API gagal."
        );
      }

      return result;
    }

    // Putaran pertama: Gemini membaca pesan pengguna.
    let result = await callGemini(contents);

    // Maksimal tiga putaran pemanggilan fungsi.
    for (let round = 0; round < 3; round++) {
      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const functionCalls = parts.filter(
        part => part.functionCall
      );

      // Jika tidak ada permintaan fungsi, jawaban sudah selesai.
      if (functionCalls.length === 0) {
        break;
      }

      // Simpan respons Gemini yang berisi permintaan fungsi.
      contents.push(candidate.content);

      for (const part of functionCalls) {
        const functionCall = part.functionCall;

        if (functionCall.name !== "get_stock") {
          contents.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: functionCall.name,
                  response: {
                    error: "Fungsi tidak tersedia."
                  }
                }
              }
            ]
          });

          continue;
        }

        const date = functionCall.args?.date;

        if (
          date &&
          !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {
          contents.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "get_stock",
                  response: {
                    error: "Format tanggal tidak valid."
                  }
                }
              }
            ]
          });

          continue;
        }

        // Membaca data melalui API Stock yang sudah ada.
        const stockUrl = new URL(
          "/api/stock",
          stockApiBase
        );

        if (date) {
          stockUrl.searchParams.set("date", date);
        }

        const stockResponse = await fetch(stockUrl.toString());
        const stockData = await stockResponse.json();

        const functionResult = stockResponse.ok
          ? stockData
          : {
              error:
                stockData.error ||
                "Gagal membaca data stok."
            };

        // Mengirim hasil API kembali kepada Gemini.
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "get_stock",
                response: functionResult
              }
            }
          ]
        });
      }

      // Gemini menyusun jawaban berdasarkan hasil API.
      result = await callGemini(contents);
    }

    const reply =
      result.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!reply) {
      return res.status(502).json({
        error: "Gemini tidak menghasilkan jawaban."
      });
    }

    return res.status(200).json({
      reply
    });

  } catch (error) {
    console.error("Stock AI error:", error);

    return res.status(500).json({
      error: error.message || "Terjadi kesalahan pada server."
    });
  }
}
