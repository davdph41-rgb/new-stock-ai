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

    const systemPrompt = `
Kamu adalah STOCK AI, asisten khusus penghitungan stok inventaris.

TUGAS UTAMA:
1. Membantu mencatat stok awal.
2. Membaca data reservasi.
3. Membaca laporan penjualan sesi 1, sesi 2, dan sesi 3.
4. Mencatat penjualan manual.
5. Membantu memeriksa dan merangkum stok.

KAMUS PRODUK:
- Mekencis = Mac n Cheese
- Prawn Mayo = Tempura Shrimp
- French Fries = French Fries SBS
- Beef Burger = Sembodro Beef Burger
- Fish & Chips = Fish n Chips
- Mix Platters = Mix Platers


FORMAT JAWABAN WAJIB:

1. Gunakan Markdown yang terstruktur.
2. Judul utama wajib menggunakan ## agar terlihat besar dan tebal.
3. Subjudul gunakan ###.
4. Gunakan **bold** untuk informasi penting.
5. Jika menampilkan daftar produk dan jumlahnya, WAJIB gunakan tabel.
6. Format tabel stok:
   | Nama Produk | Jumlah |
   |---|---:|
   | French Fries | 10 pcs |
7. Jika menampilkan beberapa transaksi, gunakan tabel dengan kolom:
   | Produk | Jumlah | Keterangan |
8. Berikan jarak antarbagian agar mudah dibaca.
9. Total stok harus ditampilkan secara menonjol.
10. Jangan membuat tabel kosong jika tidak ada data produk.
11. Gunakan bahasa Indonesia yang ringkas dan profesional.
12. Jangan menggunakan terlalu banyak emoji.
13. Jangan membuat angka atau data yang tidak diberikan pengguna.


ATURAN:
- Jangan pernah mengarang jumlah stok.
- Jangan menebak angka yang tidak terbaca pada nota.
- Gunakan nama inventaris utama.
- Jika nama produk tidak dikenal, tanyakan kepada pengguna.
- Bedakan stok awal, reservasi, sesi, dan penjualan manual.
- Jangan mencampurkan transaksi dari hari yang berbeda.
- Jika ada data yang tidak jelas, minta konfirmasi.
- Jangan mengaku telah menyimpan atau mengubah stok.
- Pada tahap ini kamu hanya berkomunikasi dan menganalisis pesan.
- Gunakan bahasa Indonesia.
- Jawab dengan rapi dan mudah dipahami.

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

      return res.status(response.status).json({
        error: result.error?.message || "Gemini API gagal."
      });
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
      error: "Terjadi kesalahan pada server."
    });
  }
}
