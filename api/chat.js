import { createHash } from "node:crypto";

function getJakartaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getBaseUrl(req) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const origin = req.headers.origin;
  if (origin) return origin;
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method tidak diizinkan." });
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
      return res.status(400).json({ error: "Pesan tidak boleh kosong." });
    }

    if (
      image &&
      (!image.mimeType?.startsWith("image/") ||
        !image.data ||
        image.data.length > 7_000_000)
    ) {
      return res.status(400).json({
        error: "Format atau ukuran gambar tidak valid."
      });
    }

    const today = getJakartaDate();
    const baseUrl = getBaseUrl(req);

    const lastUserMessage = [...messages]
      .reverse()
      .find(message => message.sender !== "ai");

    const sourceText = String(lastUserMessage?.text || "");
    const requestSource = image?.data || sourceText;

    // Mendeteksi pertanyaan stok.
    const normalizedQuestion = sourceText.toLowerCase();

    const asksOpeningStock =
      /\bstok awal\b|\bstock awal\b/.test(normalizedQuestion);

    const asksStock =
      /\bstok\b|\bstock\b/.test(normalizedQuestion);

    const looksLikeTransaction =
      /reservasi|penjualan|terjual|nota|\bsesi\s*[123]\b|kurangkan|dikurangi|tambahkan|ubah stok|set stok/.test(
        normalizedQuestion
      );

    const isStockQuestion =
      !image && asksStock && !looksLikeTransaction;

    // Pertanyaan stok langsung mengambil data dari database.
    if (isStockQuestion) {
      const url = new URL("/api/stock", baseUrl);

      url.searchParams.set("date", today);

      if (!asksOpeningStock) {
        url.searchParams.set("mode", "current");
      }

      const stockResponse = await fetch(url);
      const stockData = await stockResponse.json();

      if (!stockResponse.ok || !stockData.success) {
        return res.status(200).json({
          reply: `Maaf, data stok tanggal ${today} belum dapat dibaca dari database. ${
            stockData.error || "Silakan periksa data stok harian."
          }`
        });
      }

      let rows;
      let heading;

      if (asksOpeningStock) {
        rows = (stockData.items || []).map(item => ({
          name: item.name,
          quantity: Number(item.openingQuantity || 0)
        }));

        heading = "STOK AWAL";
      } else {
        rows = (stockData.stock || []).map(item => ({
          name: item.productName,
          quantity: Number(item.remainingStock || 0)
        }));

        heading = "STOK TERBARU / TERSEDIA";
      }

      if (!rows.length) {
        return res.status(200).json({
          reply: `Belum ada data ${heading.toLowerCase()} untuk tanggal ${today}.`
        });
      }

      const total = rows.reduce(
        (sum, item) => sum + item.quantity,
        0
      );

      const table = rows
        .map(item => `| ${item.name} | ${item.quantity} pcs |`)
        .join("\n");

      const reply = `**${heading} — ${today}**

| Produk | Jumlah |
|---|---:|
${table}
| **TOTAL** | **${total} pcs** |`;

      return res.status(200).json({ reply });
    }

    const requestKey = createHash("sha256")
      .update(`${today}|${requestSource}`)
      .digest("hex");

    const systemPrompt = `
Kamu adalah STOCK AI, asisten inventaris yang hanya mengurus stok.
Tanggal hari ini di Indonesia: ${today}.

ALUR STOK:
- Stock awal diambil dari halaman Stock Management dan disimpan di database.
- Reservasi mengurangi stock awal.
- Sesi 1, 2, dan 3 mengurangi sisa setelah reservasi dan sesi sebelumnya.
- Setiap tanggal berdiri sendiri. Jangan campurkan transaksi dari tanggal lain.
- Gunakan get_current_stock untuk membaca stock terbaru. Jangan mengarang angka.
- Setelah transaksi berhasil disimpan, panggil get_current_stock lagi untuk menampilkan sisa terbaru.

CARA MEMBACA PESAN / FOTO:
- Pengguna dapat mengirim tabel reservasi atau nota penjualan dalam teks/foto.
- Ambil hanya jumlah produk makanan yang ada dalam daftar produk database.
- Abaikan minuman, entrance, dan item lain yang bukan produk inventaris.
- Nama alias: Tempura Shrimp/Tempura Shirmp = Prawn Mayo; Mekencis/Mac n Cheese = Mekencis; French Fries SBS = French Fries; Sembodro Beef Burger = Beef Burger; Fish n Chips = Fish & Chips; Mix Platers = Mix Platters.
- Gunakan nama produk database yang dikembalikan get_current_stock.
- Jika nama/jumlah produk tidak jelas atau tidak cocok, jangan simpan; tanyakan klarifikasi.

JENIS TRANSAKSI:
- Tabel reservasi atau pengguna menyebut reservasi: transactionType = reservation.
- Penjualan tambahan yang bukan nota sesi: transactionType = manual_sales.
- Nota sesi: transactionType = session_sales dan wajib menentukan sessionNumber.
- Jika pengguna menyebut sesi 1/2/3, ikuti itu.
- Jika pengguna tidak menyebut sesi tetapi foto nota menampilkan waktu, tentukan sesi berdasarkan jam nota dan jadwal: Sabtu/Minggu sesi 1 10:00-12:00, sesi 2 12:00-15:00, sesi 3 15:00-17:00; Senin-Jumat sesi 1 12:00-15:00, sesi 2 15:00-17:00.
- Jika tanggal tidak disebutkan dan tidak terbaca di nota, gunakan tanggal hari ini (${today}). Jika tanggal lama/berbeda terlihat jelas, gunakan tanggal tersebut. Jika sesi tidak dapat ditentukan dari keterangan atau jam nota, tanyakan dulu. Jangan menebak sesi.
- Jika belum ada stock awal untuk tanggal itu, jangan simpan transaksi dan arahkan pengguna mengisi stock awal di halaman Pengaturan.
- Jangan pernah menyimpan transaksi hanya karena pengguna bertanya atau meminta contoh. Simpan hanya saat pesan/foto jelas berisi data reservasi atau penjualan nyata.
- Jangan simpan transaksi yang sama dua kali. Server akan menolak kiriman duplikat.

FUNGSI:
1. get_current_stock(date): membaca stock awal dan stock tersisa untuk tanggal tertentu.
2. record_stock_transaction(transactionType, date, sessionNumber, items, description): menyimpan transaksi nyata. Item harus berupa nama produk database dan jumlah positif. Untuk reservation/manual_sales, sessionNumber boleh null. Untuk session_sales wajib 1, 2, atau 3.

JAWABAN:
- Bahasa Indonesia, ringkas dan jelas.
- Setelah penyimpanan berhasil, sebutkan jenis transaksi, tanggal, sesi bila ada, produk yang dikurangi, dan sisa stok terbaru.
- Jika stok tidak cukup atau sesi terkunci, jelaskan dan jangan mengklaim transaksi berhasil.
- Jangan mengklaim tersimpan sebelum fungsi record_stock_transaction menyatakan berhasil.
`;

    const contents = messages.slice(-20).map(message => ({
      role: message.sender === "ai" ? "model" : "user",
      parts: [{ text: String(message.text || "") }]
    }));

    if (image) {
      const last = contents[contents.length - 1];

      last.parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }

    const tools = [
      {
        function_declarations: [
          {
            name: "get_current_stock",
            description: "Membaca stok awal dan stok tersisa untuk tanggal tertentu.",
            parameters: {
              type: "OBJECT",
              properties: {
                date: {
                  type: "STRING",
                  description: "Tanggal YYYY-MM-DD"
                }
              },
              required: ["date"]
            }
          },
          {
            name: "record_stock_transaction",
            description: "Menyimpan reservasi atau penjualan yang benar-benar dikirim pengguna.",
            parameters: {
              type: "OBJECT",
              properties: {
                transactionType: {
                  type: "STRING",
                  enum: ["reservation", "manual_sales", "session_sales"]
                },
                date: {
                  type: "STRING",
                  description: "Tanggal YYYY-MM-DD"
                },
                sessionNumber: {
                  type: "INTEGER",
                  description: "1, 2, atau 3 untuk penjualan sesi; null untuk lainnya"
                },
                items: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      productName: { type: "STRING" },
                      quantity: { type: "INTEGER" }
                    },
                    required: ["productName", "quantity"]
                  }
                },
                description: { type: "STRING" }
              },
              required: ["transactionType", "date", "items"]
            }
          }
        ]
      }
    ];

    async function callGemini() {
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
            contents,
            tools,
            tool_config: {
              function_calling_config: { mode: "AUTO" }
            },
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 2048
            }
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error?.message || "Gemini API gagal."
        );
      }

      return result;
    }

    let result = await callGemini();

    for (let round = 0; round < 4; round++) {
      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const calls = parts.filter(part => part.functionCall);

      if (!calls.length) break;

      contents.push(candidate.content);

      const functionResponses = [];

      for (const part of calls) {
        const call = part.functionCall;
        const args = call.args || {};

        let functionResult;

        if (call.name === "get_current_stock") {
          const date = args.date || today;

          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            functionResult = {
              success: false,
              error: "Format tanggal tidak valid."
            };
          } else {
            const url = new URL("/api/stock", baseUrl);

            url.searchParams.set("date", date);
            url.searchParams.set("mode", "current");

            const response = await fetch(url);
            functionResult = await response.json();

            if (!response.ok) {
              functionResult.success = false;
            }
          }
        } else if (call.name === "record_stock_transaction") {
          const transactionType = args.transactionType;
          const date = args.date || today;
          const items = Array.isArray(args.items) ? args.items : [];

          const response = await fetch(
            new URL("/api/products", baseUrl)
          );

          const productResult = await response.json();

          if (!response.ok || !productResult.success) {
            functionResult = {
              success: false,
              error: "Tidak dapat membaca daftar produk."
            };
          } else {
            const normalize = value =>
              String(value || "")
                .toLowerCase()
                .replace(/[^a-z0-9]/g, "");

            const aliases = {
              [normalize("Tempura Shrimp")]: "Prawn Mayo",
              [normalize("Tempura Shirmp")]: "Prawn Mayo",
              [normalize("Mekencis")]: "Mekencis",
              [normalize("Mac n Cheese")]: "Mekencis",
              [normalize("French Fries SBS")]: "French Fries",
              [normalize("Sembodro Beef Burger")]: "Beef Burger",
              [normalize("Fish n Chips")]: "Fish & Chips",
              [normalize("Mix Platers")]: "Mix Platters"
            };

            const productByName = new Map(
              productResult.products.map(product => [
                normalize(product.name),
                product
              ])
            );

            const cleanItems = [];
            let mappingError = null;

            for (const item of items) {
              const rawName = String(item.productName || "").trim();
              const mappedName = aliases[normalize(rawName)] || rawName;
              const product = productByName.get(normalize(mappedName));
              const quantity = Number(item.quantity);

              if (
                !product ||
                !Number.isSafeInteger(quantity) ||
                quantity <= 0
              ) {
                mappingError = `Produk atau jumlah tidak valid: ${rawName || "(kosong)"}.`;
                break;
              }

              const existing = cleanItems.find(
                entry => entry.productId === Number(product.id)
              );

              if (existing) {
                existing.quantity += quantity;
              } else {
                cleanItems.push({
                  productId: Number(product.id),
                  quantity
                });
              }
            }

            if (mappingError || !cleanItems.length) {
              functionResult = {
                success: false,
                error: mappingError || "Tidak ada produk yang dapat disimpan."
              };
            } else {
              const saveResponse = await fetch(
                new URL("/api/transactions", baseUrl),
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    transactionType,
                    date,
                    sessionNumber: args.sessionNumber ?? null,
                    description: args.description || "Dicatat melalui Chat AI",
                    items: cleanItems,
                    requestKey
                  })
                }
              );

              functionResult = await saveResponse.json();

              if (!saveResponse.ok) {
                functionResult.success = false;
              }
            }
          }
        } else {
          functionResult = {
            success: false,
            error: "Fungsi tidak tersedia."
          };
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: functionResult
          }
        });
      }

      contents.push({
        role: "user",
        parts: functionResponses
      });

      result = await callGemini();
    }

    const reply = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "Gemini tidak menghasilkan jawaban."
      });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error("Stock AI error:", error);

    return res.status(500).json({
      error: error.message || "Terjadi kesalahan pada server."
    });
  }
}
