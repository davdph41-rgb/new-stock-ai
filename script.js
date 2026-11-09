
let selectedImage = null;
let chats = [];
let currentChat = null;

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
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function renderHistory() {
  const history = document.getElementById("chatHistory");

  history.innerHTML = chats.map(chat => `
    <div class="history-item" onclick="openChat(${chat.id})">
      ${escapeHTML(chat.title)}
    </div>
  `).join("");
}

function openChat(id) {
  currentChat = chats.find(c => c.id === id);

  const messages = document.getElementById("messages");
  messages.innerHTML = "";

  currentChat.messages.forEach(msg => {
    addMessage(msg.text, msg.sender, false);
  });

  document.getElementById("welcome").style.display = "none";
  messages.style.display = "block";
  toggleSidebar();
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

  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;
  sendBtn.textContent = "...";

  try {
    let image = null;

    if (imageFile) {
      image = {
        mimeType: imageFile.type,
        data: await fileToBase64(imageFile)
      };
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };

    reader.onerror = () => reject(
      new Error("Gagal membaca gambar.")
    );

    reader.readAsDataURL(file);
  });
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
