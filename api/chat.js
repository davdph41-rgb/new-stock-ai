
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method tidak diizinkan."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model =
    process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

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
- Gunakan fungsi get_stock jika pengguna bertanya tentang stok.
- Jika tanggal tidak diberikan, gunakan tanggal hari ini.
- Jika pengguna menyebut tanggal tertentu, gunakan format YYYY-MM-DD.
- Jangan mengarang data stok.
- Gunakan hanya hasil dari get_stock.
- Jika data tidak ditemukan, jelaskan bahwa data belum tersedia.
- Data API saat ini adalah stok awal, bukan stok akhir setelah penjualan.
- Jangan mengaku telah mengubah atau menyimpan stok.

ATURAN UMUM:
- Gunakan nama inventaris utama.
- Jika nama produk tidak dikenal, tanyakan kepada pengguna.
- Bedakan stok awal, reservasi, penjualan sesi, dan penjualan manual.
- Jangan mencampurkan transaksi dari hari berbeda.
- Jika data tidak jelas, minta konfirmasi.
- Gunakan bahasa Indonesia yang ringkas dan profesional.

FORMAT JAWABAN:
1. Gunakan Markdown terstruktur.
2. Judul utama gunakan ##.
3. Subjudul gunakan ###.
4. Gunakan bold untuk informasi penting.
5. Jika menampilkan beberapa produk, gunakan tabel:
   | Nama Produk | Jumlah |
   |---|---:|
   | French Fries | 10 pcs |
6. Tampilkan total stok jika datanya tersedia.
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

      contents[contents.length - 1].parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }

    // Alamat API Stock AI
    const stockApiBase = "https://new-stock-ai.vercel.app";

    // Fungsi yang tersedia untuk Gemini
    const tools = [
      {
        function_declarations: [
          {
            name: "get_stock",
            description:
              "Membaca stok awal produk dari database Neon berdasarkan tanggal.",
            parameters: {
              type: "OBJECT",
              properties: {
                date: {
                  type: "STRING",
                  description: "Tanggal format YYYY-MM-DD."
                }
              },
              required: ["date"]
            }
          }
        ]
      }
    ];

    // Fungsi pemanggilan Gemini
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

    // Permintaan pertama ke Gemini
    let result = await callGemini(contents);

    // Maksimal tiga putaran Function Calling
    for (let round = 0; round < 3; round++) {
      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const functionCalls = parts.filter(
        part => part.functionCall
      );

      if (functionCalls.length === 0) {
        break;
      }

      contents.push(candidate.content);

      const functionResponses = [];

      for (const part of functionCalls) {
        const functionCall = part.functionCall;

        if (functionCall.name !== "get_stock") {
          functionResponses.push({
            functionResponse: {
              name: functionCall.name,
              response: {
                error: "Fungsi tidak tersedia."
              }
            }
          });
          continue;
        }

        const date = functionCall.args?.date || today;

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          functionResponses.push({
            functionResponse: {
              name: "get_stock",
              response: {
                error: "Format tanggal tidak valid."
              }
            }
          });
          continue;
        }

        // Memanggil API Stock
        const stockUrl = new URL(
          "/api/stock",
          stockApiBase
        );

        stockUrl.searchParams.set("date", date);

        const stockResponse = await fetch(stockUrl.toString());

        const responseText = await stockResponse.text();

        let stockData;

        try {
          stockData = JSON.parse(responseText);
        } catch {
          throw new Error(
            "Stock API mengembalikan HTML, bukan JSON."
          );
        }

        if (!stockResponse.ok || !stockData.success) {
          stockData = {
            error:
              stockData.error ||
              "Gagal mengambil data stok."
          };
        }

        functionResponses.push({
          functionResponse: {
            name: "get_stock",
            response: stockData
          }
        });
      }

      contents.push({
        role: "user",
        parts: functionResponses
      });

      // Mengirim data stok kembali kepada Gemini
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
      error: error.message ||
        "Terjadi kesalahan pada server."
    });
  }
}
