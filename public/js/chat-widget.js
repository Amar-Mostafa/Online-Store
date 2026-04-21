// ===== Chat Widget =====
const ChatWidget = {
  conversationId: null,
  lastMessageId: 0,
  pollInterval: null,
  isOpen: false,
  myProducts: [],
  selectedProduct: null,

  init() {
    this.injectHTML();
    this.bindEvents();
  },

  injectHTML() {
    const widget = document.createElement('div');
    widget.id = 'chatWidget';
    widget.innerHTML = `
      <button class="chat-fab" id="chatFab" title="Chat with Support">
        <span class="chat-fab-icon" id="chatFabIcon">💬</span>
      </button>
      <div class="chat-window hidden" id="chatWindow">
        <div class="chat-header">
          <div class="chat-header-info">
            <span class="chat-header-dot"></span>
            <div>
              <strong>Customer Support</strong>
              <small id="chatStatus">Online</small>
            </div>
          </div>
          <div class="chat-header-actions">
            <button class="chat-close-btn" id="chatCloseConvo" title="End Chat">End</button>
            <button class="chat-minimize-btn" id="chatMinimize" title="Minimize">—</button>
          </div>
        </div>
        <div class="chat-body" id="chatBody">
          <div class="chat-welcome" id="chatWelcome">
            <div style="font-size:2rem;margin-bottom:8px;">👋</div>
            <p><strong>Hi there!</strong></p>
            <p>Need help? Our support team is here for you.</p>
            <button class="btn btn-primary btn-sm" id="chatStartBtn" style="margin-top:12px;">Start Chat</button>
          </div>
        </div>
        <div class="chat-footer hidden" id="chatFooter">
          <input type="text" class="chat-input" id="chatInput" placeholder="Type a message..." autocomplete="off">
          <button class="chat-send-btn" id="chatSendBtn">➤</button>
        </div>
      </div>
    `;
    document.body.appendChild(widget);
  },

  bindEvents() {
    document.getElementById('chatFab').addEventListener('click', () => this.toggle());
    document.getElementById('chatMinimize').addEventListener('click', () => this.toggle());
    document.getElementById('chatStartBtn').addEventListener('click', () => this.startChat());
    document.getElementById('chatSendBtn').addEventListener('click', () => this.sendMessage());
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
    document.getElementById('chatCloseConvo').addEventListener('click', () => this.endChat());

    if (Auth.isLoggedIn()) {
      this.checkActiveConversation();
    }
  },

  toggle() {
    this.isOpen = !this.isOpen;
    document.getElementById('chatWindow').classList.toggle('hidden', !this.isOpen);
    document.getElementById('chatFabIcon').textContent = this.isOpen ? '✕' : '💬';
    if (this.isOpen && this.conversationId) {
      this.scrollToBottom();
    }
  },

  async checkActiveConversation() {
    try {
      const res = await fetch('/api/chat/active', {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      const convo = await res.json();
      if (convo && convo.id) {
        this.conversationId = convo.id;
        this.showChatUI();
        this.loadMessages();
        this.startPolling();
      }
    } catch (e) {}
  },

  async loadMyProducts() {
    try {
      const res = await fetch('/api/orders/my-products', {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) { this.myProducts = []; return; }
      this.myProducts = await res.json();
    } catch (e) { this.myProducts = []; }
  },

  async startChat() {
    if (!Auth.isLoggedIn()) {
      showToast('Please sign in to start a chat', 'error');
      setTimeout(() => { window.location.href = '/login.html'; }, 1000);
      return;
    }

    await this.loadMyProducts();

    try {
      const res = await fetch('/api/chat/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getToken()}`
        }
      });
      const convo = await res.json();
      if (!res.ok) throw new Error(convo.error);

      this.conversationId = convo.id;
      this.showChatUI();
      this.loadMessages();
      this.startPolling();
    } catch (e) {
      showToast(e.message || 'Failed to start chat', 'error');
    }
  },

  showChatUI() {
    const body = document.getElementById('chatBody');

    const hasProducts = this.myProducts && this.myProducts.length > 0;
    const productPickerHTML = hasProducts ? `
      <div class="chat-product-picker" id="chatProductPicker">
        <div class="chat-picker-title">Which product do you need help with?</div>
        <div class="chat-picker-list">
          ${this.myProducts.map(p => `
            <button class="chat-product-chip" data-pid="${p.id}" data-pname="${this.escapeAttr(p.name)}" data-order="${p.last_order_id}">
              <span class="chip-name">${this.escapeHtml(p.name)}</span>
              <span class="chip-meta">Order #${p.last_order_id}</span>
            </button>
          `).join('')}
          <button class="chat-product-chip chat-product-other" data-pid="other">
            <span class="chip-name">Something else</span>
            <span class="chip-meta">General question</span>
          </button>
        </div>
        <div class="chat-picker-topics hidden" id="chatPickerTopics">
          <div class="chat-picker-title">What's the issue with <strong id="pickerProductName"></strong>?</div>
          <div class="chat-picker-list">
            <button class="chat-topic-chip" data-topic="Login / access problem">Can't sign in / access</button>
            <button class="chat-topic-chip" data-topic="Product not working">Not working properly</button>
            <button class="chat-topic-chip" data-topic="Wrong credentials received">Wrong credentials</button>
            <button class="chat-topic-chip" data-topic="Refund request">Refund request</button>
            <button class="chat-topic-chip" data-topic="Renewal question">Renewal / subscription</button>
            <button class="chat-topic-chip" data-topic="Other">Other</button>
          </div>
          <button class="chat-picker-back" id="chatPickerBack">← Back to products</button>
        </div>
      </div>
    ` : `
      <div class="chat-product-picker">
        <div class="chat-picker-title">How can we help you today?</div>
        <div class="chat-picker-list">
          <button class="chat-topic-chip" data-topic="General question">Ask a general question</button>
          <button class="chat-topic-chip" data-topic="Pre-purchase question">Before I buy — question</button>
          <button class="chat-topic-chip" data-topic="Technical issue">Technical issue</button>
        </div>
      </div>
    `;

    body.innerHTML = `
      ${productPickerHTML}
      <div class="chat-messages" id="chatMessages"></div>
    `;
    document.getElementById('chatFooter').classList.remove('hidden');
    document.getElementById('chatInput').focus();

    this.bindPickerEvents();
  },

  bindPickerEvents() {
    document.querySelectorAll('.chat-product-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        if (pid === 'other') {
          this.selectedProduct = null;
          this.sendContextMessage({ text: 'I have a general question (not about a specific product).' });
          this.hidePicker();
          return;
        }
        this.selectedProduct = {
          id: pid,
          name: btn.dataset.pname,
          order_id: btn.dataset.order
        };
        // Show topic sub-picker
        document.getElementById('pickerProductName').textContent = btn.dataset.pname;
        document.querySelector('.chat-picker-list').classList.add('hidden');
        document.querySelector('.chat-picker-title').classList.add('hidden');
        document.getElementById('chatPickerTopics').classList.remove('hidden');
      });
    });

    const backBtn = document.getElementById('chatPickerBack');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        document.querySelector('.chat-picker-list').classList.remove('hidden');
        document.querySelector('.chat-picker-title').classList.remove('hidden');
        document.getElementById('chatPickerTopics').classList.add('hidden');
      });
    }

    document.querySelectorAll('.chat-topic-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const topic = btn.dataset.topic;
        const ctx = this.selectedProduct
          ? `Hi, I need help with **${this.selectedProduct.name}** (Order #${this.selectedProduct.order_id}). Topic: ${topic}.`
          : `Hi, I'd like to ask about: ${topic}.`;
        this.sendContextMessage({ text: ctx });
        this.hidePicker();
      });
    });
  },

  hidePicker() {
    const picker = document.getElementById('chatProductPicker');
    if (picker) picker.style.display = 'none';
  },

  async sendContextMessage({ text }) {
    if (!this.conversationId) return;
    try {
      await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ conversation_id: this.conversationId, message: text })
      });
      this.loadMessages();
    } catch (e) {}
  },

  async loadMessages() {
    if (!this.conversationId) return;
    try {
      const url = `/api/chat/messages/${this.conversationId}${this.lastMessageId ? `?after_id=${this.lastMessageId}` : ''}`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        data.messages.forEach(msg => {
          if (msg.id <= this.lastMessageId) return;

          const isMe = msg.sender_id === Auth.getUser()?.id;
          const isSystem = msg.message.startsWith('---') && msg.message.endsWith('---');

          if (isSystem) {
            container.innerHTML += `<div class="chat-system-msg">${this.escapeHtml(msg.message.replace(/---/g, '').trim())}</div>`;
          } else {
            const time = new Date(msg.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            container.innerHTML += `
              <div class="chat-msg ${isMe ? 'chat-msg-me' : 'chat-msg-them'}">
                ${!isMe ? `<div class="chat-msg-name">${this.escapeHtml(msg.sender_name || 'Support')}</div>` : ''}
                <div class="chat-msg-bubble">${this.escapeHtml(msg.message)}</div>
                <div class="chat-msg-time">${time}</div>
              </div>
            `;
          }
        });

        this.lastMessageId = data.messages[data.messages.length - 1].id;
        this.scrollToBottom();
      }

      if (data.conversation) {
        const statusEl = document.getElementById('chatStatus');
        if (data.conversation.status === 'assigned') {
          statusEl.textContent = 'Agent connected';
          statusEl.style.color = '#00B894';
        } else if (data.conversation.status === 'closed') {
          statusEl.textContent = 'Chat ended';
          this.stopPolling();
        } else {
          statusEl.textContent = 'Waiting for agent...';
        }
      }
    } catch (e) {}
  },

  async sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message || !this.conversationId) return;

    input.value = '';

    try {
      await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ conversation_id: this.conversationId, message })
      });
      this.hidePicker();
      this.loadMessages();
    } catch (e) {
      showToast('Failed to send message', 'error');
    }
  },

  async endChat() {
    if (!this.conversationId) return;
    if (!confirm('End this chat?')) return;

    try {
      await fetch(`/api/chat/close/${this.conversationId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
      });
      this.stopPolling();
      this.conversationId = null;
      this.lastMessageId = 0;
      this.selectedProduct = null;
      document.getElementById('chatBody').innerHTML = `
        <div class="chat-welcome">
          <div style="font-size:2rem;margin-bottom:8px;">✅</div>
          <p><strong>Chat ended</strong></p>
          <p>Thank you for contacting support!</p>
          <button class="btn btn-primary btn-sm" id="chatStartBtn" style="margin-top:12px;" onclick="ChatWidget.startChat()">Start New Chat</button>
        </div>
      `;
      document.getElementById('chatFooter').classList.add('hidden');
      document.getElementById('chatStatus').textContent = 'Online';
    } catch (e) {}
  },

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => this.loadMessages(), 3000);
  },

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  },

  scrollToBottom() {
    const body = document.getElementById('chatBody');
    if (body) body.scrollTop = body.scrollHeight;
  },

  escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  escapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  ChatWidget.init();
});
