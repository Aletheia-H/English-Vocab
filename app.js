/**
 * 復古學院黑板風 英文單字卡系統 - 核心邏輯 (Application Controller)
 * 包含：
 * 1. 批次練習量動態篩選 (10, 20, 30, 50, 100, 全部)
 * 2. 深度字卡背面 (單字, KK音標, 詞性, 中文解釋, 例句+翻譯+發音, 俚語+翻譯+發音, 5同義詞, 5反義詞, 3字首衍生字, 3字尾衍生字)
 * 3. 三段式艾賓浩斯記憶法 (🟢非常熟悉、🟠不熟/忘了、🔴陌生) + 非熟悉時強制引導即時拼寫
 * 4. TTS 語音朗讀、手機手勢滑動、離線 LocalStorage 數據管理
 */

// ===================================================================
// 全域狀態與常數
// ===================================================================
const STORAGE_KEY_MASTERED = 'chalkboard_vocab_mastered_v1';
const STORAGE_KEY_CUSTOM = 'chalkboard_vocab_custom_v1';
const STORAGE_KEY_SETTINGS = 'chalkboard_vocab_settings_v1';

let vocabList = [];
let sessionQueue = [];
let sessionInitialBatch = [];
let currentIndex = 0;
let currentCategory = 'all';
let currentBatchSize = '20'; // '10' | '20' | '30' | '50' | '100' | 'all'
let currentMode = 'flashcard'; // 'flashcard' | 'spelling' | 'dictionary'
let isCardFlipped = false;
let sessionMasteredCount = 0;
let pendingAssessment = null; // { type: 'hesitate' | 'stranger', word: Object }

// 手機觸控座標
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

// DOM 元素快取
let dom = {};

function initDomReferences() {
  dom = {
    flashcard: document.getElementById('flashcard'),
    cardFront: document.getElementById('cardFront'),
    cardBack: document.getElementById('cardBack'),
    cardScene: document.getElementById('cardScene'),
    categoryPills: document.getElementById('categoryPills'),
    modeTabs: document.getElementById('modeTabs'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    masteredStatCount: document.getElementById('masteredStatCount'),
    reviewStatCount: document.getElementById('reviewStatCount'),
    categoryDescText: document.getElementById('categoryDescText'),
    
    // 批次計數器
    batchSizeSelect: document.getElementById('batchSizeSelect'),
    sessionCardIndex: document.getElementById('sessionCardIndex'),
    sessionTotalCount: document.getElementById('sessionTotalCount'),

    // 視圖切換
    flashcardView: document.getElementById('flashcardView'),
    spellingView: document.getElementById('spellingView'),
    dictionaryView: document.getElementById('dictionaryView'),
    
    // 彈窗
    milestoneModal: document.getElementById('milestoneModal'),
    customWordModal: document.getElementById('customWordModal'),
    backupModal: document.getElementById('backupModal'),
    batchCompleteModal: document.getElementById('batchCompleteModal'),
    batchCompleteSummary: document.getElementById('batchCompleteSummary'),
    speechFeedback: document.getElementById('speechFeedback'),

    // 引導式拼寫彈窗
    spellingPromptModal: document.getElementById('spellingPromptModal'),
    spellingPromptBadge: document.getElementById('spellingPromptBadge'),
    spellingPromptTrans: document.getElementById('spellingPromptTrans'),
    spellingPromptPhonetic: document.getElementById('spellingPromptPhonetic'),
    spellingPromptSlots: document.getElementById('spellingPromptSlots'),
    spellingPromptInput: document.getElementById('spellingPromptInput'),
    spellingPromptFeedback: document.getElementById('spellingPromptFeedback')
  };
}

// ===================================================================
// 1. 初始化與儲存層 (Initialization & Storage)
// ===================================================================
function initApp() {
  initDomReferences();
  loadStoredData();
  buildCategoryPills();
  setupEventListeners();

  // 預設讀取批次設定
  if (dom.batchSizeSelect) {
    currentBatchSize = dom.batchSizeSelect.value || '20';
  }

  // 預載語音引擎語音列表
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }

  switchCategory('all');
}

function getMasteredIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MASTERED);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveMasteredIds(ids) {
  try {
    localStorage.setItem(STORAGE_KEY_MASTERED, JSON.stringify(ids));
  } catch (e) {
    console.error("Failed to save mastered IDs:", e);
  }
}

function getCustomWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCustomWords(words) {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(words));
  } catch (e) {
    console.error("Failed to save custom words:", e);
  }
}

function loadStoredData() {
  const customWords = getCustomWords();
  const baseData = (typeof INITIAL_VOCAB_DATA !== 'undefined') ? INITIAL_VOCAB_DATA : [];
  vocabList = [...baseData, ...customWords];
}

// ===================================================================
// 2. 分類與批次佇列管理 (Category & Batch Session Management)
// ===================================================================
function buildCategoryPills() {
  const container = dom.categoryPills;
  if (!container) return;
  if (typeof CATEGORY_DEFINITIONS === 'undefined') return;
  container.innerHTML = '';

  // 全部分類標籤
  const allBtn = document.createElement('button');
  allBtn.className = 'pill-item active';
  allBtn.dataset.cat = 'all';
  allBtn.innerHTML = '✨ 全部分類';
  allBtn.onclick = () => switchCategory('all');
  container.appendChild(allBtn);

  // 六大核心通道
  Object.values(CATEGORY_DEFINITIONS).forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'pill-item';
    btn.dataset.cat = cat.id;
    btn.innerHTML = `${cat.badge.split(' ')[0]} ${cat.shortLabel}`;
    btn.onclick = () => switchCategory(cat.id);
    container.appendChild(btn);
  });
}

function switchCategory(catId) {
  currentCategory = catId;
  document.querySelectorAll('.pill-item').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.cat === catId);
  });

  // 更新描述
  if (catId === 'all') {
    dom.categoryDescText.innerText = "涵蓋全階段：會考2000、高中7000、托福、GRE、商務多益與日常閱讀。";
  } else if (CATEGORY_DEFINITIONS[catId]) {
    dom.categoryDescText.innerText = CATEGORY_DEFINITIONS[catId].desc;
  }

  initSessionBatch();
}

// Fisher-Yates 隨機洗牌算法，確保完全隨機且分佈均勻
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function reshuffleBatch() {
  initSessionBatch();
  showFeedbackBanner('good', `🔀 已為您隨機重新抽取 ${sessionQueue.length} 張單字卡！`);
}

function changeBatchSize(newSize) {
  currentBatchSize = newSize;
  initSessionBatch();
  showFeedbackBanner('good', `📚 已為您隨機抽取 ${newSize === 'all' ? '全部單字' : newSize + ' 張'} 進行練習！`);
}

function initSessionBatch() {
  const masteredIds = getMasteredIds();
  let pool = vocabList;
  if (currentCategory !== 'all') {
    pool = vocabList.filter(item => item.category === currentCategory);
  }

  // 優先抓取未掌握單字；若當前分類已全部掌握，則載入全部單字複習
  const unmastered = pool.filter(item => !masteredIds.includes(item.id));
  const candidatePool = unmastered.length > 0 ? unmastered : pool;

  // 🎲 隨機亂序抽取 (Fisher-Yates Shuffle)：徹底打破字母排序，保證隨機出現
  const shuffledPool = shuffleArray(candidatePool);

  // 依據批次量截取本次練習序列
  if (currentBatchSize === 'all') {
    sessionQueue = shuffledPool;
  } else {
    const limit = parseInt(currentBatchSize, 10) || 20;
    sessionQueue = shuffledPool.slice(0, limit);
  }

  sessionInitialBatch = [...sessionQueue];
  currentIndex = 0;
  isCardFlipped = false;

  updateStats();
  renderCurrentCard();

  if (currentMode === 'spelling') renderSpellingCard();
  if (currentMode === 'dictionary') renderDictionaryList();
}

function updateStats() {
  const masteredIds = getMasteredIds();
  const currentTotal = currentCategory === 'all' 
    ? vocabList.length 
    : vocabList.filter(v => v.category === currentCategory).length;
  
  const currentMasteredCount = currentCategory === 'all'
    ? vocabList.filter(v => masteredIds.includes(v.id)).length
    : vocabList.filter(v => v.category === currentCategory && masteredIds.includes(v.id)).length;

  dom.masteredStatCount.innerText = currentMasteredCount;
  dom.reviewStatCount.innerText = Math.max(0, currentTotal - currentMasteredCount);

  const percent = currentTotal > 0 ? Math.round((currentMasteredCount / currentTotal) * 100) : 0;
  dom.progressBar.style.width = `${percent}%`;
  dom.progressText.innerText = `${percent}%`;

  // 更新批次進度指示器
  if (dom.sessionCardIndex && dom.sessionTotalCount) {
    if (sessionQueue.length > 0) {
      dom.sessionCardIndex.innerText = Math.min(currentIndex + 1, sessionQueue.length);
      dom.sessionTotalCount.innerText = sessionQueue.length;
    } else {
      dom.sessionCardIndex.innerText = 0;
      dom.sessionTotalCount.innerText = 0;
    }
  }
}

// ===================================================================
// 3. 字卡渲染 (Flashcard Renderer - 正面 & 深度豐富背面)
// ===================================================================
function getCurrentWord() {
  if (!sessionQueue || sessionQueue.length === 0) return null;
  return sessionQueue[currentIndex % sessionQueue.length];
}

function renderCurrentCard() {
  const word = getCurrentWord();
  if (!word) {
    if (sessionInitialBatch.length > 0) {
      openBatchCompleteModal();
    } else {
      renderEmptyCard();
    }
    return;
  }

  // 重置翻面外觀
  isCardFlipped = false;
  if (dom.flashcard) {
    dom.flashcard.classList.remove('is-flipped');
  }

  // 取得分類標籤
  const catDef = CATEGORY_DEFINITIONS[word.category] || { badge: '🔖 自訂', name: '自訂' };

  // 1. 正面渲染 (Front Face)
  dom.cardFront.innerHTML = `
    <div class="card-face-scroll">
      <div class="card-top-row">
        <span class="category-tag">${catDef.badge}</span>
        <div class="audio-buttons">
          <button class="sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.word)}')">
            🔊 念讀單字
          </button>
          <button class="sound-btn mic-btn" id="micBtn" onclick="event.stopPropagation(); startShadowing('${escapeQuotes(word.word)}')">
            🎙️ 跟讀評測
          </button>
        </div>
      </div>

      <div class="word-core-block">
        <h2 class="vocab-word">${word.word}</h2>
        <div class="phonetic-row">
          <span>${word.kkPhonetic || ''}</span>
          ${(word.partOfSpeech || []).map(pos => `<span class="pos-tag">${pos}</span>`).join('')}
        </div>
      </div>

      ${word.exampleSentence ? `
        <div class="front-sentence-hint" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.exampleSentence)}')">
          <div style="flex:1;">"${highlightWord(word.exampleSentence, word.word)}"</div>
          <button class="sentence-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.exampleSentence)}')">
            🔊 朗讀例句
          </button>
        </div>
      ` : ''}

      <div class="tap-hint" onclick="event.stopPropagation(); toggleCardFlip()">
        🔄 點擊翻面查看深度釋義 (或按空白鍵 Space)
      </div>
    </div>
  `;

  // 2. 背面深度渲染 (Back Face: 8大核心要求完整呈現)
  const synonymsList = (word.synonyms || []).slice(0, 5);
  const antonymsList = (word.antonyms || []).slice(0, 5);
  const prefixList = (word.samePrefixWords || []).slice(0, 3);
  const suffixList = (word.sameSuffixWords || []).slice(0, 3);

  dom.cardBack.innerHTML = `
    <div class="card-face-scroll">
      <!-- 標題與音標、詞性、中文解釋 -->
      <div class="back-header">
        <div>
          <div class="back-word">${word.word}</div>
          <div style="font-size:0.82rem; color:var(--chalk-cyan); margin-top:2px;">
            ${(word.partOfSpeech || []).join(' ')} ${word.kkPhonetic || ''}
          </div>
        </div>
        <div style="text-align:right;">
          <div class="back-translation">${word.translation}</div>
          <button class="sentence-sound-btn" style="margin-top:4px;" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.word)}')">
            🔊 朗讀單字
          </button>
        </div>
      </div>

      <!-- 例句與例句中文翻譯 -->
      ${word.exampleSentence ? `
        <div class="detail-section">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="section-label">📖 經典例句與中文翻譯</span>
            <button class="sentence-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.exampleSentence)}')">
              🔊 朗讀例句
            </button>
          </div>
          <div class="example-box" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.exampleSentence)}')">
            <div class="example-en">${word.exampleSentence}</div>
            <div class="example-zh">${word.exampleTranslation || ''}</div>
          </div>
        </div>
      ` : ''}

      <!-- 俚語 / 常用片語與翻譯例句 -->
      ${word.idiom ? `
        <div class="detail-section">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="section-label">💡 實用俚語／片語拓展</span>
            <button class="sentence-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.idiom.phrase)}')">
              🔊 朗讀片語
            </button>
          </div>
          <div class="idiom-box">
            <div class="idiom-phrase">${word.idiom.phrase}：${word.idiom.translation}</div>
            ${word.idiom.exampleSentence ? `
              <div class="example-en" style="margin-top:4px; font-size:0.83rem; cursor:pointer;" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.idiom.exampleSentence)}')">
                "${word.idiom.exampleSentence}"
              </div>
              <div class="example-zh" style="font-size:0.78rem;">${word.idiom.exampleTranslation || ''}</div>
            ` : ''}
          </div>
        </div>
      ` : ''}

      <!-- 5個相似詞 & 5個相反詞 -->
      ${(synonymsList.length > 0 || antonymsList.length > 0) ? `
        <div class="detail-section">
          <span class="section-label">🔗 相似詞與相反詞辨析</span>
          
          ${synonymsList.length > 0 ? `
            <div style="margin-top:3px;">
              <span style="font-size:0.75rem; color:var(--chalk-green); font-weight:600;">✨ 相似詞 (點擊聽音)：</span>
              <div class="chips-grid">
                ${synonymsList.map(s => `
                  <span class="word-chip synonym" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(s)}')">
                    ${s} 🔊
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${antonymsList.length > 0 ? `
            <div style="margin-top:6px;">
              <span style="font-size:0.75rem; color:var(--chalk-pink); font-weight:600;">⚡ 相反詞 (點擊聽音)：</span>
              <div class="chips-grid">
                ${antonymsList.map(a => `
                  <span class="word-chip antonym" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(a)}')">
                    ${a} 🔊
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- 字首・字根・字尾 邏輯拆解與家族 (True Etymology Breakdown) -->
      ${word.etymology ? `
        <div class="detail-section etymology-section">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="section-label">🧩 字根字首邏輯拆解</span>
            <button class="guide-mini-btn" onclick="event.stopPropagation(); openEtymologyGuide()">
              📖 記憶法解析
            </button>
          </div>

          <!-- 三零件拆解標籤與推導公式 -->
          <div class="morph-formula-box">
            <div class="morph-parts-row">
              ${word.etymology.prefix ? `
                <span class="morph-tag tag-prefix" title="字首改變方向/意思">
                  [字首] <b>${word.etymology.prefix.part}</b> <small>(${word.etymology.prefix.meaning})</small>
                </span>
              ` : ''}
              ${word.etymology.prefix && word.etymology.root ? `<span class="morph-plus">＋</span>` : ''}
              ${word.etymology.root ? `
                <span class="morph-tag tag-root" title="字根為核心實質意義">
                  [字根] <b>${word.etymology.root.part}</b> <small>(${word.etymology.root.meaning})</small>
                </span>
              ` : ''}
              ${word.etymology.suffix ? `
                <span class="morph-plus">＋</span>
                <span class="morph-tag tag-suffix" title="字尾決定詞性">
                  [字尾] <b>${word.etymology.suffix.part}</b> <small>(${word.etymology.suffix.meaning})</small>
                </span>
              ` : ''}
            </div>
            ${word.etymology.formula ? `
              <div class="morph-synthesis">
                💡 <b>邏輯推導：</b>${word.etymology.formula}
              </div>
            ` : ''}
          </div>

          <!-- 同字根家族延伸 (滾雪球速記) -->
          ${(word.etymology.rootFamily && word.etymology.rootFamily.length > 0) ? `
            <div style="margin-top:8px;">
              <div style="font-size:0.75rem; color:var(--chalk-yellow); font-weight:600; margin-bottom:4px;">
                🌱 同字根家族延伸（滾雪球記憶法・點擊聽音）：
              </div>
              <div class="family-chips-grid">
                ${word.etymology.rootFamily.map(fam => `
                  <div class="family-chip" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(fam.word)}')">
                    <span class="family-word">${fam.word}</span>
                    <span class="family-trans">${fam.meaning}</span>
                    <span class="family-sound-icon">🔊</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="tap-hint" style="margin-top:14px;" onclick="event.stopPropagation(); toggleCardFlip()">
        🔄 點擊翻回正面
      </div>
    </div>
  `;

  // 更新計數指示
  if (dom.sessionCardIndex && dom.sessionTotalCount) {
    dom.sessionCardIndex.innerText = Math.min(currentIndex + 1, sessionQueue.length);
    dom.sessionTotalCount.innerText = sessionQueue.length;
  }
}

function renderEmptyCard() {
  dom.cardFront.innerHTML = `
    <div style="margin: auto; text-align: center;">
      <div style="font-size: 3rem;">🎉</div>
      <h3 style="margin-top: 10px; color: var(--chalk-yellow);">太棒了！當前分類單字已全部掌握！</h3>
      <p style="margin-top: 6px; font-size: 0.85rem; color: var(--chalk-dim);">您可以切換上方分類，或點擊下方重置學習進度。</p>
    </div>
  `;
  dom.cardBack.innerHTML = '';
}

function toggleCardFlip() {
  isCardFlipped = !isCardFlipped;
  dom.flashcard.classList.toggle('is-flipped', isCardFlipped);
}

// ===================================================================
// 4. 三大選項艾賓浩斯記憶法評估與強制拼寫引導 (Requirement 3)
// ===================================================================

/**
 * 處理字卡評估選項：
 * 'familiar': 🟢 非常熟悉 (之後的字卡不再出現，直接跳下一張)
 * 'hesitate': 🟠 不熟/忘了 (將字卡排序往中間排序，必須提示練習拼寫)
 * 'stranger': 🔴 陌生 (將此字卡在1~2張卡片後排序，必須提示練習拼寫)
 */
function handleCardAssessment(type) {
  const currentWord = getCurrentWord();
  if (!currentWord) return;

  if (type === 'familiar') {
    // 🟢 非常熟悉：標記已掌握，自本機與當前序列移除，不再出現
    const masteredIds = getMasteredIds();
    if (!masteredIds.includes(currentWord.id)) {
      masteredIds.push(currentWord.id);
      saveMasteredIds(masteredIds);
    }

    // 自隊列移除
    sessionQueue.splice(currentIndex, 1);
    if (currentIndex >= sessionQueue.length) {
      currentIndex = 0;
    }

    sessionMasteredCount++;
    playChalkSuccessSound();
    updateStats();

    if (sessionQueue.length === 0) {
      openBatchCompleteModal();
      return;
    }

    triggerCardTransition('next');

    // 每累積掌握 10 個觸發成就獎章
    if (sessionMasteredCount > 0 && sessionMasteredCount % 10 === 0) {
      openMilestoneModal();
    }
  } else if (type === 'hesitate' || type === 'stranger') {
    // 🟠 不熟 / 忘了 或 🔴 陌生：必須啟動即時引導拼寫測驗！
    pendingAssessment = {
      type: type,
      word: currentWord
    };
    openSpellingPrompt(type, currentWord);
  }
}

// ===================================================================
// 5. 即時引導式拼寫練習彈窗 (Guided Active Recall Spelling Modal)
// ===================================================================
function openSpellingPrompt(type, word) {
  if (!dom.spellingPromptModal) {
    initDomReferences();
  }
  if (!dom.spellingPromptModal) return;

  // 設置彈窗標題徽章
  if (type === 'hesitate') {
    dom.spellingPromptBadge.innerText = '🟠 不熟 / 忘了・強化拼寫練習';
    dom.spellingPromptBadge.style.color = 'var(--chalk-orange)';
    dom.spellingPromptBadge.style.borderColor = 'var(--chalk-orange)';
  } else {
    dom.spellingPromptBadge.innerText = '🔴 陌生生字・引導拼寫練習';
    dom.spellingPromptBadge.style.color = 'var(--chalk-pink)';
    dom.spellingPromptBadge.style.borderColor = 'var(--chalk-pink)';
  }

  // 釋義與音標
  dom.spellingPromptTrans.innerText = word.translation;
  dom.spellingPromptPhonetic.innerText = `${(word.partOfSpeech || []).join(' ')} ${word.kkPhonetic || ''}`;

  // 渲染字母遮蔽格子 (首尾字母提供提示)
  const cleanWord = word.word.trim().toLowerCase();
  dom.spellingPromptSlots.innerHTML = cleanWord.split('').map((char, idx) => {
    // 特殊字符(連字號、空格)直接顯示
    if (char === '-' || char === ' ') {
      return `<div class="spell-slot revealed" style="border:none;">${char}</div>`;
    }
    const isHint = (idx === 0 || (cleanWord.length > 4 && idx === cleanWord.length - 1));
    return `<div class="spell-slot ${isHint ? 'revealed' : ''}" data-idx="${idx}">${isHint ? char : ''}</div>`;
  }).join('');

  // 清空輸入框與反饋
  dom.spellingPromptInput.value = '';
  dom.spellingPromptFeedback.innerText = '';
  dom.spellingPromptFeedback.style.color = 'var(--chalk-yellow)';

  // 顯示彈窗並聚焦輸入框
  dom.spellingPromptModal.classList.add('active');
  setTimeout(() => {
    dom.spellingPromptInput.focus();
    // 同步朗讀一次單字聽音
    playPronunciation(word.word);
  }, 120);
}

function submitSpellingPrompt() {
  if (!pendingAssessment) {
    closeSpellingPrompt(true);
    return;
  }

  const targetWord = pendingAssessment.word.word.trim().toLowerCase();
  const inputVal = dom.spellingPromptInput.value.trim().toLowerCase();

  if (inputVal === targetWord) {
    // 拼寫完全正確！
    dom.spellingPromptFeedback.innerText = '🎉 拼寫正確！大腦記憶已成功強化！';
    dom.spellingPromptFeedback.style.color = 'var(--chalk-green)';
    playChalkSuccessSound();

    // 揭露所有格子
    revealSpellingPromptAnswer(true);

    setTimeout(() => {
      finishSpellingPrompt();
    }, 700);
  } else {
    // 拼寫有誤
    dom.spellingPromptFeedback.innerText = '❌ 拼寫未完全相符，請再檢查或點擊下方「💡 顯示全字」！';
    dom.spellingPromptFeedback.style.color = 'var(--chalk-pink)';
    dom.spellingPromptInput.classList.add('error-shake');
    setTimeout(() => dom.spellingPromptInput.classList.remove('error-shake'), 400);
  }
}

function revealSpellingPromptAnswer(silent = false) {
  if (!pendingAssessment) return;
  const targetWord = pendingAssessment.word.word.trim().toLowerCase();
  const slots = dom.spellingPromptSlots.querySelectorAll('.spell-slot');
  slots.forEach((slot, idx) => {
    if (targetWord[idx]) {
      slot.innerText = targetWord[idx];
      slot.classList.add('revealed');
    }
  });

  if (!silent) {
    dom.spellingPromptInput.value = targetWord;
    dom.spellingPromptFeedback.innerText = `💡 正確拼寫：${pendingAssessment.word.word}，請點「送出」確認後跳轉！`;
    dom.spellingPromptFeedback.style.color = 'var(--chalk-yellow)';
  }
}

function playSpellingPromptAudio() {
  if (pendingAssessment && pendingAssessment.word) {
    playPronunciation(pendingAssessment.word.word);
  }
}

function closeSpellingPrompt(cancelReorder = false) {
  if (dom.spellingPromptModal) {
    dom.spellingPromptModal.classList.remove('active');
  }
  if (!cancelReorder && pendingAssessment) {
    finishSpellingPrompt();
  } else {
    pendingAssessment = null;
    triggerCardTransition('next');
  }
}

function finishSpellingPrompt() {
  if (!pendingAssessment) return;
  const { type, word } = pendingAssessment;

  // 關閉彈窗
  if (dom.spellingPromptModal) {
    dom.spellingPromptModal.classList.remove('active');
  }

  // 隊列重排邏輯
  if (sessionQueue.length > 1) {
    const currentCard = sessionQueue.splice(currentIndex, 1)[0];

    if (type === 'hesitate') {
      // 🟠 不熟/忘了：將字卡的排序往中間排序
      const midOffset = Math.max(2, Math.floor(sessionQueue.length / 2));
      const targetIndex = Math.min(sessionQueue.length, currentIndex + midOffset);
      sessionQueue.splice(targetIndex, 0, currentCard);
    } else if (type === 'stranger') {
      // 🔴 陌生：將此字卡在 1~2 張卡片後排序
      const nearOffset = Math.min(2, Math.max(1, sessionQueue.length));
      const targetIndex = Math.min(sessionQueue.length, currentIndex + nearOffset);
      sessionQueue.splice(targetIndex, 0, currentCard);
    }
  }

  if (currentIndex >= sessionQueue.length) {
    currentIndex = 0;
  }

  pendingAssessment = null;
  updateStats();
  triggerCardTransition('next');
}

function triggerCardTransition(direction) {
  if (!dom.flashcard) return;
  dom.flashcard.style.opacity = '0';
  dom.flashcard.style.transform = direction === 'next' ? 'translateX(30px)' : 'translateX(-30px)';
  
  setTimeout(() => {
    renderCurrentCard();
    dom.flashcard.style.transform = 'translateX(0)';
    dom.flashcard.style.opacity = '1';
  }, 160);
}

// ===================================================================
// 6. 批次練習完成彈窗控制 (Batch Completion Controller)
// ===================================================================
function openBatchCompleteModal() {
  if (!dom.batchCompleteModal) return;
  const count = sessionInitialBatch.length;
  dom.batchCompleteSummary.innerHTML = `
    太棒了！您已將本次設定的 <b>${count}</b> 張單字練習全部掌握！<br>
    艾賓浩斯記憶法建議：每日複習，記憶留存率將提升 80% 以上！
  `;
  dom.batchCompleteModal.classList.add('active');
  playChalkSuccessSound();
}

function closeBatchCompleteModal() {
  if (dom.batchCompleteModal) {
    dom.batchCompleteModal.classList.remove('active');
  }
}

function startNextBatch() {
  closeBatchCompleteModal();
  initSessionBatch();
}

function repeatCurrentBatch() {
  closeBatchCompleteModal();
  // 重新裝載上一批次的單字
  sessionQueue = [...sessionInitialBatch];
  currentIndex = 0;
  updateStats();
  renderCurrentCard();
}

// ===================================================================
// 7. 手機觸控滑動手勢 (Mobile Swipe Gestures)
// ===================================================================
function setupTouchEvents() {
  const cardScene = document.getElementById('cardScene');
  if (!cardScene) return;

  cardScene.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  cardScene.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipeGesture();
  }, { passive: true });
}

function handleSwipeGesture() {
  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;
  
  // 避免垂直捲動誤判為橫向滑動
  if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 48) {
    if (deltaX < 0) {
      // 往左滑：非常熟悉 (下張)
      handleCardAssessment('familiar');
    } else {
      // 往右滑：不熟/陌生 (觸發引導拼寫)
      handleCardAssessment('stranger');
    }
  }
}

// ===================================================================
// 8. 語音朗讀 TTS 與 語音跟讀 STT
// ===================================================================
function playPronunciation(text) {
  if (!('speechSynthesis' in window)) {
    alert("您的瀏覽器暫不支援語音合成發音。");
    return;
  }
  if (!text) return;
  try {
    window.speechSynthesis.cancel();
    // Chromium 延遲 50ms 解決同步取消新發音問題
    setTimeout(() => {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;

      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find(v => v.lang && (v.lang.startsWith('en-US') || v.lang.startsWith('en')));
      if (enVoice) {
        utterance.voice = enVoice;
      }
      window.speechSynthesis.speak(utterance);
    }, 50);
  } catch (err) {
    console.error("SpeechSynthesis error:", err);
  }
}

function startShadowing(targetWord) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showFeedbackBanner('retry', '您的設備目前不支援麥克風語音辨識，請點「🔊 念讀」跟著出聲練習！');
    return;
  }

  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.add('listening');

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    showFeedbackBanner('good', '🎙️ 聆聽中... 請念出這個單字！');
  };

  recognition.onresult = (event) => {
    const spokenText = event.results[0][0].transcript.trim().toLowerCase();
    const cleanTarget = targetWord.trim().toLowerCase();
    
    if (spokenText === cleanTarget) {
      showFeedbackBanner('excellent', `🌟 太棒了！您念得非常標準！(${spokenText})`);
      playChalkSuccessSound();
    } else if (spokenText.includes(cleanTarget) || cleanTarget.includes(spokenText)) {
      showFeedbackBanner('good', `👍 很好！發音相當接近：聽到 "${spokenText}"`);
    } else {
      showFeedbackBanner('retry', `💪 聽到 "${spokenText}"，點擊「念讀」聽一遍後再試一次！`);
    }
  };

  recognition.onerror = () => {
    showFeedbackBanner('retry', '未偵測到清晰聲音，請在安靜處再試一次！');
  };

  recognition.onend = () => {
    if (micBtn) micBtn.classList.remove('listening');
  };

  recognition.start();
}

function showFeedbackBanner(type, message) {
  const banner = dom.speechFeedback;
  if (!banner) return;
  banner.className = `speech-feedback-banner ${type}`;
  banner.innerText = message;
  banner.style.display = 'block';

  setTimeout(() => {
    banner.style.display = 'none';
  }, 4000);
}

// ===================================================================
// 9. 獨立拼寫測驗視圖 (Spelling Quiz Tab Mode)
// ===================================================================
function renderSpellingCard() {
  const word = getCurrentWord();
  if (!word) return;

  const cleanWord = word.word.toLowerCase();
  const slotsHtml = cleanWord.split('').map((char, idx) => {
    const isFirstOrLast = (idx === 0 || idx === cleanWord.length - 1);
    return `<div class="spell-slot ${isFirstOrLast ? 'revealed' : ''}" data-idx="${idx}">
      ${isFirstOrLast ? char : ''}
    </div>`;
  }).join('');

  dom.spellingView.innerHTML = `
    <div class="spelling-card">
      <div style="font-size:0.8rem; color:var(--chalk-cyan);">${(word.partOfSpeech || []).join(' ')} ${word.kkPhonetic || ''}</div>
      <div class="spell-hint-translation">${word.translation}</div>
      
      <div class="spell-mask-slots" id="maskSlots">${slotsHtml}</div>

      <div class="spell-input-group">
        <input type="text" id="spellInput" class="spell-input" placeholder="輸入正確拼寫..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button class="spell-submit-btn" onclick="checkSpelling()">送出</button>
      </div>

      <div class="spell-actions-row">
        <button class="spell-hint-btn" onclick="playPronunciation('${escapeQuotes(word.word)}')">🔊 聽音提示</button>
        <button class="spell-hint-btn" onclick="revealSpelling()">💡 顯示全字</button>
      </div>
    </div>
  `;

  const inputEl = document.getElementById('spellInput');
  if (inputEl) {
    inputEl.focus();
    inputEl.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') checkSpelling();
    });
  }
}

function checkSpelling() {
  const input = document.getElementById('spellInput');
  if (!input) return;

  const currentWord = getCurrentWord();
  if (!currentWord) return;

  const userVal = input.value.trim().toLowerCase();
  const correctVal = currentWord.word.trim().toLowerCase();

  if (userVal === correctVal) {
    showFeedbackBanner('excellent', `🎉 拼寫完全正確！太厲害了！`);
    handleCardAssessment('familiar');
    setTimeout(() => {
      renderSpellingCard();
    }, 1000);
  } else {
    showFeedbackBanner('retry', `❌ 拼寫有誤，再檢查一下喔！`);
    input.classList.add('error-shake');
    setTimeout(() => input.classList.remove('error-shake'), 400);
  }
}

function revealSpelling() {
  const currentWord = getCurrentWord();
  if (!currentWord) return;
  const slots = document.querySelectorAll('#maskSlots .spell-slot');
  const cleanWord = currentWord.word.toLowerCase();
  slots.forEach((slot, i) => {
    slot.innerText = cleanWord[i];
    slot.classList.add('revealed');
  });
}

// ===================================================================
// 10. 字典速查視圖 (Dictionary Tab Mode)
// ===================================================================
function renderDictionaryList(query = '') {
  const listEl = document.getElementById('dictList');
  if (!listEl) return;

  const q = query.trim().toLowerCase();
  const filtered = vocabList.filter(item => {
    return item.word.toLowerCase().includes(q) ||
           (item.translation || '').includes(q) ||
           (item.exampleSentence || '').toLowerCase().includes(q);
  });

  const toRender = filtered.slice(0, 60);
  listEl.innerHTML = toRender.map(item => {
    return `
      <div class="dict-item-card" onclick="jumpToWord('${item.id}')">
        <div>
          <span class="dict-word-text">${item.word}</span>
          <span style="font-size:0.75rem; color:var(--chalk-cyan); margin-left:6px;">${(item.partOfSpeech || []).join(' ')}</span>
        </div>
        <div class="dict-word-zh">${item.translation}</div>
      </div>
    `;
  }).join('') + (filtered.length > 60 ? `
    <div style="text-align:center; padding:12px; font-size:0.75rem; color:var(--chalk-faint);">
      已顯示前 60 筆結果（共 ${filtered.length} 筆，請輸入更多關鍵字以精確篩選）
    </div>
  ` : '');
}

function jumpToWord(wordId) {
  const target = vocabList.find(v => v.id === wordId);
  if (target) {
    sessionQueue = [target, ...sessionQueue.filter(v => v.id !== wordId)];
    currentIndex = 0;
    switchMode('flashcard');
    renderCurrentCard();
  }
}

// ===================================================================
// 11. 視圖標籤切換 (Mode Switcher)
// ===================================================================
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (dom.flashcardView) dom.flashcardView.style.display = mode === 'flashcard' ? 'block' : 'none';
  if (dom.dictionaryView) dom.dictionaryView.style.display = mode === 'dictionary' ? 'flex' : 'none';

  if (mode === 'flashcard') renderCurrentCard();
  if (mode === 'dictionary') renderDictionaryList();
}

// ===================================================================
// 12. 彈窗與本機自訂單字 / 備份管理 (Modals & Custom Data)
// ===================================================================
function openMilestoneModal() {
  dom.milestoneModal.classList.add('active');
}

function closeMilestoneModal() {
  dom.milestoneModal.classList.remove('active');
}

function openCustomWordModal() {
  dom.customWordModal.classList.add('active');
}

function closeCustomWordModal() {
  dom.customWordModal.classList.remove('active');
}

function openBackupModal() {
  dom.backupModal.classList.add('active');
}

function closeBackupModal() {
  dom.backupModal.classList.remove('active');
}

function handleAddCustomWord() {
  const word = document.getElementById('customWordInput').value.trim();
  const trans = document.getElementById('customTransInput').value.trim();
  const cat = document.getElementById('customCatSelect').value;
  const sentence = document.getElementById('customSentenceInput').value.trim();

  if (!word || !trans) {
    alert("請至少填寫單字與中文翻譯！");
    return;
  }

  const newWordObj = {
    id: `custom_${Date.now()}`,
    word: word,
    kkPhonetic: "",
    partOfSpeech: ["n."],
    translation: trans,
    category: cat,
    exampleSentence: sentence || `Always practice using ${word} in daily conversation.`,
    exampleTranslation: sentence ? "" : `在日常交流中多加練習使用 ${word}。`,
    synonyms: [],
    antonyms: [],
    samePrefixWords: [],
    sameSuffixWords: [],
    idiom: null
  };

  const customWords = getCustomWords();
  customWords.push(newWordObj);
  saveCustomWords(customWords);
  loadStoredData();
  switchCategory(currentCategory);
  closeCustomWordModal();
  alert("🎉 單字已成功加入您的專屬單字庫！");
}

function exportBackupData() {
  const data = {
    mastered: getMasteredIds(),
    customWords: getCustomWords(),
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chalkboard_vocab_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackupData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.mastered) saveMasteredIds(data.mastered);
      if (data.customWords) saveCustomWords(data.customWords);
      loadStoredData();
      switchCategory(currentCategory);
      closeBackupModal();
      alert("✅ 備份資料已成功匯入！進度已同步。");
    } catch (err) {
      alert("匯入失敗：檔案格式不正確！");
    }
  };
  reader.readAsText(file);
}

// ===================================================================
// 13. 輔助工具函式
// ===================================================================
function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function highlightWord(sentence, targetWord) {
  if (!sentence || !targetWord) return sentence;
  const regex = new RegExp(`(${targetWord})`, 'gi');
  return sentence.replace(regex, `<span style="color:var(--chalk-yellow); font-weight:600;">$1</span>`);
}

function playChalkSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (e) {}
}

// ===================================================================
// 14. 事件監聽 (Event Listeners)
// ===================================================================
function setupEventListeners() {
  // 點擊卡片本體翻面
  if (dom.flashcard) {
    dom.flashcard.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
        return;
      }
      toggleCardFlip();
    });
  }

  // 拼寫彈窗輸入框 Enter 鍵監聽
  if (dom.spellingPromptInput) {
    dom.spellingPromptInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        submitSpellingPrompt();
      }
    });
  }

  // PC 鍵盤快捷鍵支援
  document.addEventListener('keydown', (e) => {
    // 若引導拼寫彈窗處於開啟狀態，不響應翻卡或主畫面快捷鍵
    if (dom.spellingPromptModal && dom.spellingPromptModal.classList.contains('active')) {
      if (e.key === 'Escape') {
        closeSpellingPrompt(true);
      }
      return;
    }

    if (currentMode !== 'flashcard') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      toggleCardFlip();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      handleCardAssessment('familiar');
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      handleCardAssessment('stranger');
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      handleCardAssessment('hesitate');
    } else if (e.key === '1') {
      const w = getCurrentWord();
      if (w) playPronunciation(w.word);
    } else if (e.key === '2') {
      const w = getCurrentWord();
      if (w && w.exampleSentence) playPronunciation(w.exampleSentence);
    }
  });

  setupTouchEvents();

  // 字典即時搜尋監聽
  const dictSearchInput = document.getElementById('dictSearchInput');
  if (dictSearchInput) {
    dictSearchInput.addEventListener('input', (e) => {
      renderDictionaryList(e.target.value);
    });
  }
}

// 字首・字根・字尾記憶法指南彈窗
function openEtymologyGuide() {
  const modal = document.getElementById('etymologyGuideModal');
  if (modal) {
    modal.classList.add('active');
  }
}

function closeEtymologyGuide() {
  const modal = document.getElementById('etymologyGuideModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

window.openEtymologyGuide = openEtymologyGuide;
window.closeEtymologyGuide = closeEtymologyGuide;

// 頁面加載完成後啟動
document.addEventListener('DOMContentLoaded', initApp);
