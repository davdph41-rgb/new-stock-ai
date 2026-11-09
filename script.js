
let selectedImage = null;
let chats = [];
let currentChat = null;
const CHAT_STORAGE_KEY = "stock_ai_chats_v1";

function saveChats() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats.slice(0, 60)));
  } catch (error) {
    console.warn("Riwayat chat tidak dapat disimpan:", error);
  }
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "[]");
    chats = Array.isArray(saved) ? saved.filter(chat => chat && chat.id && Array.isArray(chat.messages)) : [];
  } catch {
    chats = [];
  }
  renderHistory();
  if (chats.length) openChat(chats[0].id);
}

function promptHistoryDate() {
  const value = window.prompt(
    "Masukkan tanggal riwayat (YYYY-MM-DD):",
    getLocalDateString()
  );
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    alert("Format tanggal harus YYYY-MM-DD.");
    return null;
  }
  return value.trim();
}

function createChat() {
  return {
    id: Date.now(),
    title: "Percakapan baru",
    messages: []
  };
}

function newChat() {
  currentChat = createChat();
  chats.unshift(currentChat);

  document.getElementById("messages").innerHTML = "";
  document.getElementById("messages").style.display = "none";
  document.getElementById("welcome").style.display = "block";
  document.getElementById("messageInput").value = "";

  renderHistory();
  saveChats();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("open");
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (sidebar) sidebar.classList.remove("open");
}

function setActiveMenu(button) {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });

  if (button) button.classList.add("active");
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function showConversation(button) {
  setActiveMenu(button);
  closeSidebar();

  const welcome = document.getElementById("welcome");
  const messages = document.getElementById("messages");

  if (currentChat && currentChat.messages.length) {
    messages.style.display = "block";
    welcome.style.display = "none";
  } else {
    messages.style.display = "none";
    welcome.style.display = "block";
  }
}

function quickMessage(text) {
  const input = document.getElementById("messageInput");
  if (!input) return;

  input.value = text;
  input.focus();
  sendMessage();
}

async function showTransactionHistory(button) {
  setActiveMenu(button);
  closeSidebar();

  if (!currentChat) {
    currentChat = createChat();
    chats.unshift(currentChat);
  }

  const date = promptHistoryDate();
  if (!date) return;
  addMessage(`Memuat riwayat transaksi ${date}...`, "ai");

  try {
    const response = await fetch(`/api/transactions?date=${encodeURIComponent(date)}`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Gagal memuat riwayat transaksi.");
    }

    if (!result.transactions || result.transactions.length === 0) {
      addMessage(`Belum ada transaksi pada tanggal ${date}.`, "ai");
      return;
    }

    let report = `## Riwayat Transaksi — ${date}\n\n`;
    result.transactions.forEach((transaction, index) => {
      const typeLabels = {
        reservation: "Reservasi",
        manual_sales: "Penjualan Manual",
        session_sales: `Penjualan Sesi ${transaction.session_number || "-"}`
      };

      report += `**${index + 1}. Transaksi #${transaction.transaction_number || transaction.id}**\n`;
      report += `Jenis: ${typeLabels[transaction.transaction_type] || transaction.transaction_type}\n`;
      report += `Waktu: ${transaction.created_at ? new Date(transaction.created_at).toLocaleString("id-ID") : "-"}\n`;

      (transaction.items || []).forEach(item => {
        report += `- ${item.productName}: ${item.quantity} pcs\n`;
      });

      report += "\n";
    });

    addMessage(report, "ai");
  } catch (error) {
    addMessage(`Gagal memuat riwayat transaksi: ${error.message}`, "ai");
  }
}

async function showDailyHistory(button) {
  setActiveMenu(button);
  closeSidebar();

  if (!currentChat) {
    currentChat = createChat();
    chats.unshift(currentChat);
  }

  const date = promptHistoryDate();
  if (!date) return;
  addMessage(`Memuat riwayat sesi ${date}...`, "ai");

  try {
    const response = await fetch(`/api/sessions?date=${encodeURIComponent(date)}`);
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Gagal memuat riwayat harian.");
    }

    let report = `## Riwayat Harian — ${date}\n\n`;
    report += `Jumlah sesi: ${result.totalSessions}\n\n`;

    result.sessions.forEach(session => {
      report += `### Sesi ${session.sessionNumber} (${session.startTime}–${session.endTime})\n`;
      report += `Status: ${session.status === "closed" ? "Ditutup" : "Terbuka"}\n`;

      if (!session.summary || session.summary.length === 0) {
        report += "Belum ada penjualan tercatat.\n\n";
      } else {
        session.summary.forEach(item => {
          report += `- ${item.productName}: ${item.totalSold} pcs\n`;
        });
        report += "\n";
      }
    });

    addMessage(report, "ai");
  } catch (error) {
    addMessage(`Gagal memuat riwayat harian: ${error.message}`, "ai");
  }
}

function openStockSettings(button) {
  setActiveMenu(button);
  window.location.href = "stock-management.html";
}

function renderHistory() {
  const history = document.getElementById("chatHistory");
  if (!history) return;

  history.innerHTML = chats.map(chat => `
    <div class="history-item" onclick="openChat(${Number(chat.id)})">
      ${escapeHTML(chat.title)}
    </div>
  `).join("");
  saveChats();
}

function openChat(id) {
  const selectedChat = chats.find(chat => chat.id === Number(id));
  if (!selectedChat) return;

  currentChat = selectedChat;

  const messages = document.getElementById("messages");
  const welcome = document.getElementById("welcome");
  if (!messages || !welcome) return;

  messages.innerHTML = "";

  currentChat.messages.forEach(msg => {
    addMessage(msg.text, msg.sender, false);
  });

  welcome.style.display = currentChat.messages.length ? "none" : "block";
  messages.style.display = currentChat.messages.length ? "block" : "none";
  closeSidebar();
  saveChats();
}


function addMessage(text, sender, save = true) {
  const messages = document.getElementById("messages");

  document.getElementById("welcome").style.display = "none";
  messages.style.display = "block";

  const message = document.createElement("div");
  message.className = "message " + sender;

  if (sender === "ai") {
    const avatar = document.createElement("div");
    avatar.className = "ai-avatar";
    avatar.textContent = "S";
    message.appendChild(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";

  if (sender === "ai") {
    renderAIMessage(content, text);
  } else {
    content.textContent = text;
  }

  message.appendChild(content);
  messages.appendChild(message);

  if (save && currentChat) {
    currentChat.messages.push({ text, sender });
    saveChats();
  }

  messages.scrollTop = messages.scrollHeight;
}


// MEMBACA FORMAT JAWABAN AI

function renderAIMessage(container, text) {
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i++;
      continue;
    }

    // TABEL
    if (line.startsWith("|") && lines[i + 1]?.includes("---")) {
      const table = document.createElement("table");
      table.className = "ai-table";

      const headers = line
        .split("|")
        .slice(1, -1)
        .map(x => x.trim());

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      headers.forEach(header => {
        const th = document.createElement("th");
        th.textContent = header;
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      i += 2;

      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const values = lines[i]
          .trim()
          .split("|")
          .slice(1, -1)
          .map(x => x.trim());

        const row = document.createElement("tr");

        values.forEach(value => {
          const td = document.createElement("td");
          addInlineFormatting(td, value);
          row.appendChild(td);
        });

        tbody.appendChild(row);
        i++;
      }

      table.appendChild(tbody);
      container.appendChild(table);
      continue;
    }

    // JUDUL UTAMA
    if (line.startsWith("## ")) {
      const heading = document.createElement("h2");
      addInlineFormatting(heading, line.slice(3));
      container.appendChild(heading);
      i++;
      continue;
    }

    // SUBJUDUL
    if (line.startsWith("### ")) {
      const heading = document.createElement("h3");
      addInlineFormatting(heading, line.slice(4));
      container.appendChild(heading);
      i++;
      continue;
    }

    // LIST
    if (/^[-*] /.test(line)) {
      const list = document.createElement("div");
      list.className = "ai-list";

      while (
        i < lines.length &&
        /^[-*] /.test(lines[i].trim())
      ) {
        const item = document.createElement("div");
        item.className = "ai-list-item";

        const bullet = document.createElement("span");
        bullet.textContent = "•";

        const content = document.createElement("span");
        addInlineFormatting(
          content,
          lines[i].trim().slice(2)
        );

        item.append(bullet, content);
        list.appendChild(item);
        i++;
      }

      container.appendChild(list);
      continue;
    }

    // PARAGRAF
    const paragraph = document.createElement("p");
    addInlineFormatting(paragraph, line);
    container.appendChild(paragraph);
    i++;
  }
}


// FORMAT BOLD DAN TEKS BIASA

function addInlineFormatting(element, text) {
  const parts = text.split(/(\*\*.*?\*\*)/g);

  parts.forEach(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const bold = document.createElement("strong");
      bold.textContent = part.slice(2, -2);
      element.appendChild(bold);
    } else {
      element.appendChild(
        document.createTextNode(part)
      );
    }
  });
}



async function sendMessage() {
  const input = document.getElementById("messageInput");
  if (!input) return;
  const text = input.value.trim();

  if (!text && !selectedImage) return;

  if (!currentChat) {
    currentChat = createChat();
    chats.unshift(currentChat);
  }

  const imageFile = selectedImage;

  let userText = text;

  if (imageFile) {
    userText += "\n[Foto nota dilampirkan]";
  }

  addMessage(userText, "user");

  if (currentChat.messages.length === 1 && text) {
    currentChat.title = text.slice(0, 30);
  }

  input.value = "";
  clearPreview();
  renderHistory();
  saveChats();

  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;
  sendBtn.textContent = "...";

  try {
    let image = null;

    if (imageFile) {
      image = await compressImage(imageFile);
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: currentChat.messages.slice(-20),
        image
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Gemini API gagal.");
    }

    addMessage(result.reply, "ai");

  } catch (error) {
    addMessage(
      "Maaf, terjadi kesalahan: " + error.message,
      "ai"
    );

  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = "↑";
  }
}

async function compressImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Foto tidak dapat dibaca. Coba pilih gambar JPG atau PNG.");
  }

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  );
  if (!blob) throw new Error("Gagal menyiapkan foto nota.");

  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Gagal membaca foto."));
    reader.readAsDataURL(blob);
  });

  return { mimeType: "image/jpeg", data };
}


function handleEnter(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function previewImage(event) {
  const file = event.target.files[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("File harus berupa gambar.");
    return;
  }

  selectedImage = file;

  const url = URL.createObjectURL(file);

  document.getElementById("preview").innerHTML = `
    <img src="${url}" alt="Preview nota">
    <button onclick="clearPreview()">Hapus foto ✕</button>
  `;
}

function clearPreview() {
  selectedImage = null;
  document.getElementById("preview").innerHTML = "";
  document.getElementById("fileInput").value = "";
}

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}



// Pulihkan daftar percakapan setelah halaman dibuka ulang.
loadChats();
