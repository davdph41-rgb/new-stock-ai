
const StockEngine = (() => {
  const STORAGE_KEY = "stock_ai_days_v1";

  function today() {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getDatabase() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveDatabase(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function getDay() {
    const db = getDatabase();
    const date = today();

    if (!db[date]) {
      db[date] = {
        date,
        openingStock: {},
        transactions: []
      };
      saveDatabase(db);
    }

    return db[date];
  }

  function getBalance(day = getDay()) {
    const balance = { ...day.openingStock };

    day.transactions.forEach(transaction => {
      transaction.items.forEach(item => {
        balance[item.name] =
          (balance[item.name] || 0) - item.quantity;
      });
    });

    return balance;
  }

  function setOpeningStock(items) {
    const day = getDay();

    if (day.transactions.length > 0) {
      throw new Error(
        "Stok awal tidak bisa diganti setelah transaksi tercatat."
      );
    }

    const stock = {};

    items.forEach(item => {
      const name = item.name.trim();
      const quantity = Number(item.quantity);

      if (!name || !Number.isInteger(quantity) || quantity < 0) {
        throw new Error("Data stok awal tidak valid.");
      }

      if (stock[name] !== undefined) {
        throw new Error(`Produk ${name} tercatat dua kali.`);
      }

      stock[name] = quantity;
    });

    if (Object.keys(stock).length === 0) {
      throw new Error("Daftar stok awal masih kosong.");
    }

    day.openingStock = stock;

    saveDay(day);

    return getBalance(day);
  }

  function saveDay(day) {
    const db = getDatabase();
    db[day.date] = day;
    saveDatabase(db);
  }

  function addTransaction(type, items, session = null) {
    const day = getDay();

    if (Object.keys(day.openingStock).length === 0) {
      throw new Error("Masukkan stok awal terlebih dahulu.");
    }

    const balance = getBalance(day);
    const cleanItems = [];

    items.forEach(item => {
      const name = item.name.trim();
      const quantity = Number(item.quantity);

      if (!name || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("Data transaksi tidak valid.");
      }

      if (!Object.hasOwn(day.openingStock, name)) {
        throw new Error(`Produk ${name} tidak ditemukan dalam stok awal.`);
      }

      const alreadyAdded = cleanItems.find(x => x.name === name);

      if (alreadyAdded) {
        alreadyAdded.quantity += quantity;
      } else {
        cleanItems.push({ name, quantity });
      }
    });

    if (cleanItems.length === 0) {
      throw new Error("Tidak ada produk dalam transaksi.");
    }

    for (const item of cleanItems) {
      if (balance[item.name] < item.quantity) {
        throw new Error(
          `Stok ${item.name} tidak mencukupi. Sisa: ${balance[item.name]}.`
        );
      }
    }

    const transaction = {
      id: day.transactions.length + 1,
      type,
      session,
      date: day.date,
      createdAt: new Date().toISOString(),
      items: cleanItems
    };

    day.transactions.push(transaction);
    saveDay(day);

    return transaction;
  }

  function getSummary() {
    const day = getDay();
    const balance = getBalance(day);

    const openingTotal = Object.values(day.openingStock)
      .reduce((sum, value) => sum + value, 0);

    const remainingTotal = Object.values(balance)
      .reduce((sum, value) => sum + value, 0);

    return {
      date: day.date,
      openingStock: day.openingStock,
      remainingStock: balance,
      openingTotal,
      remainingTotal,
      totalTransactions: day.transactions.length,
      transactions: day.transactions
    };
  }

  function getHistory() {
    return getDay().transactions;
  }

  function getDailyHistory() {
    return Object.values(getDatabase())
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  return {
    today,
    getSummary,
    getHistory,
    getDailyHistory,
    setOpeningStock,
    addTransaction
  };
})();
    
