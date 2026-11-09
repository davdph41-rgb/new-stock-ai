const dateInput = document.getElementById("stockDate");
const productList = document.getElementById("productList");
const totalStock = document.getElementById("totalStock");
const productCount = document.getElementById("productCount");
const saveButton = document.getElementById("saveStockBtn");
const statusMessage = document.getElementById("statusMessage");

let products = [];

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function showStatus(message, error = false) {
  statusMessage.textContent = message;
  statusMessage.style.color = error ? "#ef7777" : "#10a37f";
}

async function loadProducts() {
  try {
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
    showStatus("Gagal memuat stok.", true);
  }
}

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
// Tanggal berubah: ambil data dari Neon lagi
dateInput.addEventListener("change", loadStock);

// SIMPAN STOK AWAL KE NEON
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

    await loadStock();

  } catch (error) {
    showStatus(error.message, true);

  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Simpan Stok";
  }
}

// Aktifkan tombol simpan
saveButton.disabled = false;
saveButton.textContent = "Simpan Stok";
saveButton.addEventListener("click", saveStock);

// Tanggal default
dateInput.value = getToday();

// Muat data produk
loadProducts();
