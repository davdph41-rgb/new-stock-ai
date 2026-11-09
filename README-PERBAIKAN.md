# Stock AI - Versi Perbaikan

## Alur utama
- Stock awal tetap diinput dari halaman `Stock Management`.
- Chat AI membaca stock dari database Neon.
- Reservasi, penjualan manual, dan nota sesi disimpan sebagai transaksi di Neon.
- Stock tersisa dihitung dari stock awal dikurangi semua transaksi pada tanggal yang sama.
- Data tanggal berbeda tidak dicampur.
- Riwayat chat disimpan di browser perangkat melalui LocalStorage.
- Riwayat transaksi dan sesi tetap tersimpan di database.

## Variabel lingkungan Vercel
Pastikan variabel berikut tetap tersedia di Project Settings > Environment Variables:
- `DATABASE_URL`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (opsional; default `gemini-3.5-flash-lite`)

Tidak ada tabel database baru yang diperlukan oleh perubahan ini.

## Catatan
- Foto nota dikompres di browser sebelum dikirim agar lebih ringan.
- Pesan/foto yang sama pada tanggal yang sama memiliki kunci pencegah duplikasi.
- Transaksi ditolak jika stok tidak cukup atau sesi terkait sudah ditutup.
- Sesi Sabtu/Minggu: 1 (10:00-12:00), 2 (12:00-15:00), 3 (15:00-17:00).
- Sesi Senin-Jumat: 1 (12:00-15:00), 2 (15:00-17:00).
