
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
  if (req.headers.origin) {
    return req.headers.origin;
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";

  if (!host) {
    throw new Error("Alamat server tidak dapat ditentukan.");
  }

  return `${protocol}://${host}`;
}

async function readJsonResponse(response, label) {
  const raw = await response.text();

  let data;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `${label} tidak mengembalikan JSON. Periksa alamat API dan deployment Vercel.`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error || `${label} gagal (${response.status}).`
    );
  }

  return data;
}

function isValidDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function flattenAliases(value) {
  if (Array.isArray(value)) {
    return value.flatMap(item => flattenAliases(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(item => flattenAliases(item));
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);

      if (parsed && typeof parsed === "object") {
        return flattenAliases(parsed);
      }
    } catch {
      // Alias berupa teks biasa.
    }

    return value
      .split(/[,;\n|]/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
}

function makeProductLookup(products) {
  const lookup = new Map();

  for (const product of products) {
    lookup.set(normalize(product.name), product);

    for (const alias of flattenAliases(product.aliases)) {
      lookup.set(normalize(alias), product);
    }
  }

  const fallbackAliases = {
    tempshrimp: "Prawn Mayo",
    tempurashrimp: "Prawn Mayo",
    tempurashirmp: "Prawn Mayo",
    macncheese: "Mekencis",
    mekencis: "Mekencis",
    frenchfriessbs: "French Fries",
    sembodrobeefburger: "Beef Burger",
    fishnchips: "Fish & Chips",
    mixplaters: "Mix Platters",
    mixplatter: "Mix Platters"
  };

  for (const [alias, targetName] of Object.entries(fallbackAliases)) {
    const target = products.find(
      product => normalize(product.name) === normalize(targetName)
    );

    if (target) {
      lookup.set(alias, target);
    }
  }

  return lookup;
}

function formatStockReply(
  stockData,
  date,
  openingMode,
  requestedProduct
) {
  const rows = openingMode
    ? (stockData.items || []).map(item => ({
        name: item.name,
        quantity: Number(item.openingQuantity || 0)
      }))
    : (stockData.stock || []).map(item => ({
        name: item.productName,
        quantity: Number(item.remainingStock || 0)
      }));

  if (!rows.length) {
    return `Belum ada data stok untuk tanggal ${date}. Isi stok awal terlebih dahulu melalui halaman Stock Management.`;
  }

  let selectedRows = rows;

  if (requestedProduct) {
    const query = normalize(requestedProduct);

    selectedRows = rows.filter(item => {
      const name = normalize(item.name);

      return name.includes(query) || query.includes(name);
    });

    if (!selectedRows.length) {
      return `Produk "${requestedProduct}" tidak ditemukan dalam daftar stok.`;
    }
  }

  const heading = openingMode
    ? "STOK AWAL"
    : "STOK TERSEDIA";

  const total = selectedRows.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  const table = selectedRows
    .map(item => `| ${item.name} | ${item.quantity} pcs |`)
    .join("\n");

  return `**${heading} — ${date}**

| Produk | Jumlah |
|---|---:|
${table}
${requestedProduct ? "" : `| **TOTAL** | **${total} pcs** |`}`;
}

// Mendeteksi apakah pengguna secara jelas meminta penyimpanan.
function isExplicitSaveRequest(text) {
  const value = String(text || "").toLowerCase();

  const asksSave =
    /\bsimpan\b|\bsimpanlah\b|\bcatat\b|\bdicatat\b|\bmasukkan\b|\bmasukan\b|\brekam\b|\bkurangkan\b|\bdikurang\b/.test(value);

  const hasTransactionType =
    /reservasi|reservation|penjualan|terjual|nota|session.sales|sesi\s*[123]/.test(value);

  return asksSave && hasTransactionType;
}

// Mendeteksi larangan menyimpan, contoh, dan simulasi.
function isNoSaveRequest(text) {
  const value = String(text || "").toLowerCase();

  return (
    /jangan\s+(simpan|catat|masukkan)/.test(value) ||
    /tidak\s+(perlu\s+)?(simpan|catat)/.test(value) ||
    /hanya\s+(contoh|simulasi|tes|testing)/.test(value) ||
    /tes\s+ocr/.test(value) ||
    /sekadar\s+contoh/.test(value)
  );
}

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

    if (
      image &&
      (
        !image.mimeType?.startsWith("image/") ||
        !image.data ||
        image.data.length > 7_000_000
      )
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
    const normalizedQuestion = sourceText.toLowerCase();

    const explicitSaveRequest =
      isExplicitSaveRequest(sourceText);

    const noSaveRequest =
      isNoSaveRequest(sourceText);

    const allowSaving =
      explicitSaveRequest && !noSaveRequest;

    const asksOpeningStock =
      /\bstok awal\b|\bstock awal\b/.test(normalizedQuestion);

    const asksStock =
      /\bstok\b|\bstock\b/.test(normalizedQuestion);

    const looksLikeTransaction =
      /reservasi|penjualan|terjual|nota|\bsesi\s*[123]\b|kurangkan|dikurangi|tambahkan|ubah stok|set stok/.test(
        normalizedQuestion
      );

    const asksOneProduct =
      /berapa|sisa|tersisa|jumlah/.test(normalizedQuestion) &&
      !/semua|seluruh|total stok|cek stok|cek stock|stok awal|stock awal/.test(
        normalizedQuestion
      );

    const productQuestion = asksOneProduct
      ? sourceText
          .replace(
            /berapa|sisa|tersisa|jumlah|stok|stock|produk|untuk|sekarang|ada|kah|\?/gi,
            " "
          )
          .trim()
      : "";

    const isStockQuestion =
      !image && asksStock && !looksLikeTransaction;

    // Pertanyaan stok dibaca langsung dari database.
    if (isStockQuestion) {
      const url = new URL("/api/stock", baseUrl);

      url.searchParams.set("date", today);

      if (!asksOpeningStock) {
        url.searchParams.set("mode", "current");
      }

      const stockResponse = await fetch(url);
      const stockData = await readJsonResponse(
        stockResponse,
        "API stok"
      );

      if (!stockData.success) {
        return res.status(200).json({
          reply: `Maaf, data stok tanggal ${today} belum dapat dibaca. ${
            stockData.error || "Silakan periksa stok harian."
          }`
        });
      }

      return res.status(200).json({
        reply: formatStockReply(
          stockData,
          today,
          asksOpeningStock,
          productQuestion
        )
      });
    }

    const systemPrompt = `
Kamu adalah STOCK AI, asisten inventaris.
Tanggal Indonesia hari ini: ${today}.

ATURAN UTAMA:
- Gunakan database melalui fungsi yang tersedia.
- Jangan mengarang angka stok.
- Jangan pernah mengklaim transaksi tersimpan tanpa hasil fungsi yang berhasil.
- Setiap tanggal berdiri sendiri.
- Stok awal berasal dari halaman Stock Management.
- Reservasi, penjualan manual, dan penjualan sesi mengurangi stok.
- Untuk pertanyaan stok gunakan get_current_stock.
- Untuk transaksi nyata gunakan record_stock_transaction.
- Setelah menyimpan, baca kembali stok terbaru.
- Gunakan hanya produk makanan yang terdaftar di database.
- Abaikan minuman, entrance, dan item non-inventaris.

ALIAS PRODUK:
- Tempura Shrimp / Tempura Shirmp = Prawn Mayo.
- Mac n Cheese / Mekencis = Mekencis.
- French Fries SBS = French Fries.
- Sembodro Beef Burger = Beef Burger.
- Fish n Chips = Fish & Chips.
- Mix Platers = Mix Platters.
- Periksa juga alias dari database.

MEMBACA PESAN DAN FOTO:
- Baca isi nota atau tabel dengan teliti.
- Ambil nama produk dan jumlahnya saja.
- Jika nama atau jumlah tidak jelas, jangan simpan.
- Jika tanggal tidak disebutkan dan tidak terbaca, gunakan tanggal hari ini (${today}).
- Jika tanggal lama terlihat jelas, gunakan tanggal pada nota.
- Reservasi: transactionType = reservation.
- Penjualan di luar nota sesi: transactionType = manual_sales.
- Nota sesi: transactionType = session_sales.
- Jika pengguna menyebut sesi, ikuti keterangannya.
- Jika sesi tidak disebutkan, gunakan jam pada nota:
  Sabtu/Minggu:
  Sesi 1 10:00-12:00,
  Sesi 2 12:00-15:00,
  Sesi 3 15:00-17:00.
  Senin-Jumat:
  Sesi 1 12:00-15:00,
  Sesi 2 15:00-17:00.
- Jika sesi tidak dapat ditentukan, tanyakan dahulu.
- Jika stok awal tanggal itu belum tersedia, jangan menyimpan transaksi.

ATURAN PENYIMPANAN:
- Perhatikan PESAN TERAKHIR pengguna.
- Riwayat percakapan hanya konteks, bukan perintah menyimpan ulang.
- Jika pengguna mengatakan contoh, simulasi, tes OCR, atau jangan simpan, jangan menyimpan.
- Jika pengguna secara jelas meminta menyimpan reservasi atau penjualan, panggil record_stock_transaction.
- Jangan hanya membuat simulasi ketika pengguna meminta penyimpanan.
- Jangan menyimpan pertanyaan stok atau riwayat sebagai transaksi.
- Server akan memeriksa stok dan duplikasi.
- Jika server menyatakan duplicate, jangan mengklaim ada pengurangan baru.

FUNGSI:
1. get_current_stock(date):
   Membaca stok awal dan stok tersisa.
2. record_stock_transaction(
   transactionType,
   date,
   sessionNumber,
   items,
   description
):
   Menyimpan transaksi nyata.
   Nama produk harus sesuai daftar database.
   Quantity harus bilangan bulat positif.
   sessionNumber wajib untuk session_sales dan null untuk jenis lain.

JAWABAN:
- Bahasa Indonesia, ringkas dan jelas.
- Jika data kurang jelas, tanyakan satu klarifikasi.
- Jangan mengklaim berhasil sebelum fungsi menyatakan success=true.
`;

    const contents = messages.slice(-20).map(message => ({
      role: message.sender === "ai" ? "model" : "user",
      parts: [
        { text: String(message.text || "") }
      ]
    }));

    if (image) {
      let lastUserContent = null;

      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role === "user") {
          lastUserContent = contents[i];
          break;
        }
      }

      if (!lastUserContent) {
        return res.status(400).json({
          error: "Pesan pengguna untuk foto tidak ditemukan."
        });
      }

      lastUserContent.parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: image.data
        }
      });
    }

    const tools = [{
      function_declarations: [
        {
          name: "get_current_stock",
          description:
            "Membaca stok awal dan stok tersisa untuk tanggal tertentu.",
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
          description:
            "Menyimpan transaksi reservasi atau penjualan nyata yang diminta pengguna.",
          parameters: {
            type: "OBJECT",
            properties: {
              transactionType: {
                type: "STRING",
                enum: [
                  "reservation",
                  "manual_sales",
                  "session_sales"
                ]
              },
              date: {
                type: "STRING",
                description: "Tanggal YYYY-MM-DD"
              },
              sessionNumber: {
                type: "INTEGER",
                description:
                  "Nomor sesi 1, 2, atau 3 untuk session_sales."
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
            required: [
              "transactionType",
              "date",
              "items"
            ]
          }
        }
      ]
    }];

    async function callGemini() {
      const functionCallingConfig = allowSaving
        ? {
            mode: "ANY",
            allowedFunctionNames: [
              "record_stock_transaction"
            ]
          }
        : {
            mode: "AUTO"
          };

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
              function_calling_config: functionCallingConfig
            },
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 2048
            }
          })
        }
      );

      return readJsonResponse(response, "Gemini API");
    }

    async function callInternalApi(path, options) {
      const response = await fetch(
        new URL(path, baseUrl),
        options
      );

      return readJsonResponse(response, path);
    }

    async function getStockForDate(date, mode = "current") {
      if (!isValidDate(date)) {
        return {
          success: false,
          error: "Format tanggal tidak valid."
        };
      }

      const url = new URL("/api/stock", baseUrl);

      url.searchParams.set("date", date);

      if (mode === "current") {
        url.searchParams.set("mode", "current");
      }

      const response = await fetch(url);

      return readJsonResponse(response, "API stok");
    }

    // Hanya satu percobaan penyimpanan untuk setiap pesan.
    let transactionOutcome = null;

    async function saveTransaction(args) {
      if (!allowSaving) {
        return {
          success: false,
          error:
            "Pengguna belum memberikan perintah penyimpanan yang jelas. Jangan simpan transaksi."
        };
      }

      const transactionType = args.transactionType;
      const date = args.date || today;

      const sessionNumber =
        args.sessionNumber == null
          ? null
          : Number(args.sessionNumber);

      if (
        ![
          "reservation",
          "manual_sales",
          "session_sales"
        ].includes(transactionType)
      ) {
        return {
          success: false,
          error: "Jenis transaksi tidak valid."
        };
      }

      if (!isValidDate(date)) {
        return {
          success: false,
          error: "Format tanggal transaksi tidak valid."
        };
      }

      if (
        transactionType === "session_sales" &&
        ![1, 2, 3].includes(sessionNumber)
      ) {
        return {
          success: false,
          error:
            "Nomor sesi belum jelas. Tentukan sesi 1, 2, atau 3."
        };
      }

      if (
        transactionType !== "session_sales" &&
        sessionNumber !== null
      ) {
        return {
          success: false,
          error:
            "Nomor sesi hanya boleh diisi untuk penjualan sesi."
        };
      }

      const openingData = await getStockForDate(
        date,
        "opening"
      );

      if (
        !openingData.success ||
        !openingData.stockDay ||
        !Array.isArray(openingData.items) ||
        openingData.items.length === 0
      ) {
        return {
          success: false,
          error:
            `Stok awal tanggal ${date} belum tersedia. Isi stok awal melalui Stock Management terlebih dahulu.`
        };
      }

      const productResult = await callInternalApi(
        "/api/products"
      );

      if (
        !productResult.success ||
        !Array.isArray(productResult.products)
      ) {
        return {
          success: false,
          error:
            "Daftar produk database tidak dapat dibaca."
        };
      }

      const productLookup = makeProductLookup(
        productResult.products
      );

      const items = Array.isArray(args.items)
        ? args.items
        : [];

      const cleanItems = [];
      const errors = [];

      for (const item of items) {
        const rawName = String(
          item.productName || item.name || ""
        ).trim();

        const product = productLookup.get(
          normalize(rawName)
        );

        const quantity = Number(item.quantity);

        if (!product) {
          errors.push(
            `Produk "${rawName || "(kosong)"}" tidak ditemukan.`
          );
          continue;
        }

        if (
          !Number.isSafeInteger(quantity) ||
          quantity <= 0
        ) {
          errors.push(
            `Jumlah untuk ${product.name} tidak valid.`
          );
          continue;
        }

        const existing = cleanItems.find(
          entry =>
            entry.productId === Number(product.id)
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

      if (errors.length || cleanItems.length === 0) {
        return {
          success: false,
          error:
            errors.join(" ") ||
            "Tidak ada produk yang dapat disimpan."
        };
      }

      const requestKey = createHash("sha256")
        .update(
          `${date}|${transactionType}|${sessionNumber || ""}|${requestSource}`
        )
        .digest("hex");

      const saveResult = await callInternalApi(
        "/api/transactions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            transactionType,
            date,
            sessionNumber,
            description:
              args.description ||
              "Dicatat melalui Chat AI",
            items: cleanItems,
            requestKey
          })
        }
      );

      if (!saveResult.success) {
        return {
          success: false,
          error:
            saveResult.error ||
            "Transaksi tidak berhasil disimpan.",
          shortages: saveResult.shortages || []
        };
      }

      let currentData = null;

      try {
        currentData = await getStockForDate(
          date,
          "current"
        );
      } catch (error) {
        console.error(
          "Gagal membaca ulang stok:",
          error
        );
      }

      const savedItems = cleanItems.map(item => {
        const product = productResult.products.find(
          entry => Number(entry.id) === item.productId
        );

        const stockRow = currentData?.stock?.find(
          entry =>
            Number(entry.productId) === item.productId
        );

        return {
          productName:
            product?.name ||
            `Produk #${item.productId}`,
          quantity: item.quantity,
          remainingStock:
            stockRow?.remainingStock
        };
      });

      transactionOutcome = {
        success: true,
        duplicate: Boolean(saveResult.duplicate),
        transactionType,
        date,
        sessionNumber:
          transactionType === "session_sales"
            ? sessionNumber
            : null,
        transactionNumber:
          saveResult.transaction?.transactionNumber ||
          saveResult.transaction?.transaction_number ||
          saveResult.transactionNumber ||
          null,
        items: savedItems,
        stockReadSuccess: Boolean(currentData?.success)
      };

      return {
        success: true,
        duplicate: Boolean(saveResult.duplicate),
        message:
          saveResult.message ||
          "Transaksi berhasil disimpan.",
        transaction:
          saveResult.transaction || null,
        currentStock:
          currentData?.stock || [],
        stockReadSuccess:
          Boolean(currentData?.success)
      };
    }

    let result = await callGemini();

    for (let round = 0; round < 4; round++) {
      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const calls = parts.filter(
        part => part.functionCall
      );

      if (!calls.length) {
        break;
      }

      contents.push(candidate.content);

      const functionResponses = [];

      for (const part of calls) {
        const call = part.functionCall;
        const args = call.args || {};

        let functionResult;

        try {
          if (call.name === "get_current_stock") {
            const date = args.date || today;

            functionResult = await getStockForDate(
              date,
              "current"
            );
          } else if (
            call.name === "record_stock_transaction"
          ) {
            if (transactionOutcome) {
              functionResult = {
                success: false,
                error:
                  "Satu pesan hanya boleh memproses satu transaksi."
              };
            } else {
              functionResult = await saveTransaction(args);

              if (!functionResult.success) {
                transactionOutcome = {
                  success: false,
                  error:
                    functionResult.error ||
                    "Transaksi tidak berhasil disimpan."
                };
              }
            }
          } else {
            functionResult = {
              success: false,
              error: "Fungsi tidak tersedia."
            };
          }
        } catch (error) {
          functionResult = {
            success: false,
            error:
              error.message ||
              "Operasi database gagal."
          };

          if (
            call.name === "record_stock_transaction"
          ) {
            transactionOutcome = {
              success: false,
              error: functionResult.error
            };
          }
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

    // Jawaban transaksi ditentukan oleh server.
    // Gemini tidak boleh mengarang status berhasil.
    if (transactionOutcome) {
      if (!transactionOutcome.success) {
        return res.status(200).json({
          reply:
            `**Transaksi belum berhasil disimpan.**\n\nAlasan: ${transactionOutcome.error}\n\nTidak ada pengurangan stok yang dikonfirmasi oleh sistem.`
        });
      }

      const outcome = transactionOutcome;

      const typeLabels = {
        reservation: "Reservasi",
        manual_sales: "Penjualan manual",
        session_sales:
          `Penjualan sesi ${outcome.sessionNumber}`
      };

      const itemLines = outcome.items
        .map(item => {
          const remaining =
            item.remainingStock !== undefined &&
            item.remainingStock !== null
              ? ` — sisa ${item.remainingStock} pcs`
              : "";

          return `- ${item.productName}: ${item.quantity} pcs${remaining}`;
        })
        .join("\n");

      const numberLine =
        outcome.transactionNumber
          ? `Nomor transaksi: #${outcome.transactionNumber}\n`
          : "";

      const reply = outcome.duplicate
        ? `Transaksi ini **sudah pernah dicatat**. Tidak ada pengurangan stok baru.\n\nTanggal: ${outcome.date}\nJenis: ${typeLabels[outcome.transactionType]}\n${numberLine}\n${itemLines}`
        : `**Transaksi berhasil disimpan.**\n\nJenis: ${typeLabels[outcome.transactionType]}\nTanggal: ${outcome.date}\n${numberLine}\nProduk yang dicatat:\n${itemLines}`;

      return res.status(200).json({ reply });
    }

    // Jika pengguna meminta simpan tetapi Gemini tidak memanggil fungsi,
    // jangan biarkan AI memberikan simulasi seolah-olah berhasil.
    if (allowSaving) {
      return res.status(200).json({
        reply:
          "Saya belum berhasil menjalankan penyimpanan transaksi. Tidak ada transaksi yang dikonfirmasi tersimpan. Silakan kirim ulang perintah penyimpanan."
      });
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
      error:
        error.message ||
        "Terjadi kesalahan pada server."
    });
  }
}
