
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
  content.textContent = text;

  message.appendChild(content);
  messages.appendChild(message);

  if (save && currentChat) {
    currentChat.messages.push({ text, sender });
  }

  messages.scrollTop = messages.scrollHeight;
}

function quickMessage(text) {
  document.getElementById("messageInput").value = text;
  sendMessage();
}

function sendMessage() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();

  if (!text && !selectedImage) return;

  if (!currentChat) {
    currentChat = createChat();
    chats.unshift(currentChat);
  }

  let userText = text;

  if (selectedImage) {
    userText += "\n[Foto nota dilampirkan]";
  }

  addMessage(userText, "user");

  if (currentChat.messages.length === 1 && text) {
    currentChat.title = text.slice(0, 30);
  }

  input.value = "";

  clearPreview();
  renderHistory();

  setTimeout(() => {
    addMessage(
      "Pesan berhasil diterima. Sistem AI Stock belum terhubung ke Gemini. Integrasi akan dibuat pada tahap berikutnya.",
      "ai"
    );
  }, 500);
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
