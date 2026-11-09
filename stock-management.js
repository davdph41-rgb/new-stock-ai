
const dateInput = document.getElementById("stockDate");
const productList = document.getElementById("productList");
const totalStock = document.getElementById("totalStock");
const productCount = document.getElementById("productCount");
const saveButton = document.getElementById("saveStockBtn");
const statusMessage = document.getElementById("statusMessage");

const historyList = document.getElementById("stockHistoryList");
const historyStatus = document.getElementById("historyStatus");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");

let products = [];

// ================================
// TANGGAL
// ================================

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// ================================
// STATUS
// ================================

function showStatus(message, error = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = error ? "#ef7777" : "#10a37f";
}

// ================================
// MEMUAT PRODUK
// ================================

async function loadProducts() {
  try {
    productList.textContent = "Memuat daftar produk...";

    const response = await fetch("/api/products");
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Gagal mengambil produk.");
    }

    products = result.products;

    productCount.textContent = `${products.length} produk`;

    await loadStock();

  } catch (error) {
    productList.textContent = error.message;
    showStatus("Gagal memuat daftar produk.", true);
  }
}

// ================================
// MEMUAT STOK DARI NEON
// ================================

async function loadStock() {
  try {
    showStatus("Memuat data stok...");

    const date = dateInput.value;

    const response = await fetch(
      `/api/stock?date=${encodeURIComponent(date)}`
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Gagal mengambil stok.");
    }

    const savedStock = {};

    result.items.forEach(item => {
      savedStock[item.productId] = item.openingQuantity;
    });

    renderProducts(savedStock);

    if (result.stockDay) {
      showStatus(`Data stok tanggal ${date} berhasil dimuat.`);
    } else {
      showStatus("Belum ada stok awal untuk tanggal ini.");
    }

  } catch (error) {
    productList.textContent = error.message;
    showStatus("Gagal memuat stok: " + error.message, true);
  }
}

// ================================
// MENAMPILKAN PRODUK
// ================================

function renderProducts(savedStock = {}) {
  productList.innerHTML = "";

  products.forEach(product => {
    const row = document.createElement("div");
    row.className = "product-row";

    const name = document.createElement("span");
    name.className = "product-name";
    name.textContent = product.name;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.className = "product-input";
    input.dataset.productId = product.id;
    input.value = savedStock[product.id] ?? 0;

    input.setAttribute("aria-label", `Stok ${product.name}`);

    input.addEventListener("input", calculateTotal);

    row.append(name, input);
    productList.appendChild(row);
  });

  calculateTotal();
}

// ================================
// MENGHITUNG TOTAL STOK
// ================================

function calculateTotal() {
  let total = 0;

  document.querySelectorAll(".product-input").forEach(input => {
    const quantity = Number(input.value);

    if (Number.isInteger(quantity) && quantity >= 0) {
      total += quantity;
    }
  });

  totalStock.textContent = `${total} pcs`;
}

// ================================
// MENYIMPAN STOK AWAL
// ================================

async function saveStock() {
  const date = dateInput.value;
  const inputs = document.querySelectorAll(".product-input");

  if (!date) {
    showStatus("Pilih tanggal stok terlebih dahulu.", true);
    return;
  }

  const items = [];

  for (const input of inputs) {
    const productId = Number(input.dataset.productId);
    const quantity = Number(input.value);

    if (
      !Number.isSafeInteger(productId) ||
      productId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 0
    ) {
      showStatus(
        "Jumlah stok harus bilangan bulat dan tidak boleh negatif.",
        true
      );

      input.focus();
      return;
    }

    items.push({
      productId,
      quantity
    });
  }

  if (items.length === 0) {
    showStatus("Tidak ada produk untuk disimpan.", true);
    return;
  }

  const confirmed = confirm(
    `Simpan stok awal untuk tanggal ${date}?\n\n` +
    `Jumlah produk: ${items.length}\n\n` +
    "Jika tanggal tersebut sudah memiliki stok awal, " +
    "data stok awal akan diperbarui."
  );

  if (!confirmed) return;

  saveButton.disabled = true;
  saveButton.textContent = "Menyimpan...";

  try {
    showStatus("Menyimpan stok ke database...");

    const response = await fetch("/api/stock-save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        date,
        items
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || "Gagal menyimpan stok."
      );
    }

    showStatus(
      `Berhasil! Stok awal tanggal ${date} telah disimpan.`
    );

    // Muat ulang stok dan riwayat
    await loadStock();
    await loadStockHistory();

  } catch (error) {
    showStatus(error.message, true);

  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Simpan Stok";
  }
}

// ================================
// MEMBACA RIWAYAT PERUBAHAN STOK
// ================================

async function loadStockHistory() {
  try {
    historyStatus.textContent = "Memuat riwayat...";
    historyList.innerHTML = "";

    const date = dateInput.value;

    const response = await fetch(
      `/api/stock-history?date=${encodeURIComponent(date)}&limit=100`
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || "Gagal mengambil riwayat."
      );
    }

    if (!Array.isArray(result.history) || result.history.length === 0) {
      historyStatus.textContent = "Belum ada perubahan stok.";
      historyList.textContent =
        "Riwayat perubahan stok masih kosong.";
      return;
    }

    historyStatus.textContent =
      `${result.total} catatan perubahan ditemukan.`;

    result.history.forEach(item => {
      const card = document.createElement("div");
      card.className = "history-item";

      const header = document.createElement("div");
      header.className = "history-item-header";

      const name = document.createElement("strong");
      name.textContent = item.productName;

      const time = document.createElement("span");

      const dateObject = new Date(item.changedAt);

      time.textContent = Number.isNaN(dateObject.getTime())
        ? item.date
        : dateObject.toLocaleString("id-ID");

      header.append(name, time);

      const quantities = document.createElement("div");
      quantities.className = "history-quantities";

      const oldBox = document.createElement("div");

      const oldLabel = document.createElement("small");
      oldLabel.textContent = "Stok sebelumnya";

      const oldValue = document.createElement("strong");
      oldValue.textContent = `${item.oldQuantity} pcs`;

      oldBox.append(oldLabel, oldValue);

      const arrow = document.createElement("span");
      arrow.textContent = "→";

      const newBox = document.createElement("div");

      const newLabel = document.createElement("small");
      newLabel.textContent = "Stok terbaru";

      const newValue = document.createElement("strong");
      newValue.textContent = `${item.newQuantity} pcs`;

      newBox.append(newLabel, newValue);

      quantities.append(oldBox, arrow, newBox);

      card.append(header, quantities);
      historyList.appendChild(card);
    });

  } catch (error) {
    historyStatus.textContent = "Gagal memuat riwayat.";
    historyList.textContent = error.message;
  }
}

// ================================
// EVENT LISTENERS
// ================================

// Tanggal berubah
dateInput.addEventListener("change", async () => {
  await loadStock();
  await loadStockHistory();
});

// Tombol simpan
saveButton.disabled = false;
saveButton.textContent = "Simpan Stok";
saveButton.addEventListener("click", saveStock);

// Tombol muat ulang riwayat
refreshHistoryBtn.addEventListener("click", loadStockHistory);

// ================================
// INISIALISASI HALAMAN
// ================================

dateInput.value = getToday();

loadProducts();
loadStockHistory();
