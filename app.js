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
const STORAGE_KEY_SPELLING_OPTIN = 'chalkboard_spelling_optin_mode_v1';

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

// 拼寫練習 Opt-in 與間隔集中拼寫狀態
// 'every_5' (預設: 每 5 張集中) | 'every_10' | 'immediate' (即時) | 'batch_end' (整批結束時) | 'off' (關閉純刷卡)
let currentSpellingMode = 'every_5';
let pendingSpellingQueue = []; // [{ type: 'hesitate'|'stranger', word: Object }]
let cardsEvaluatedInInterval = 0; // 當前區間內已評估卡片數
let activeBatchSpellingIndex = 0; // 集中批次拼寫中單字指針
let isBatchSpellingActive = false; // 是否正在進行集中批次拼寫

// 歷史導航棧與 36K 字典全庫搜尋狀態
let navigationHistory = []; // Stack of { word, fromMode, isFlipped, queueIndex }
let currentDictScope = 'all'; // 'all' | 'junior_2000' | 'senior_7000' | 'toefl' | 'gre' | 'business' | 'reading_daily'
let dictDebounceTimer = null;

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
    
    // 歷史導航條
    cardHistoryNavBar: document.getElementById('cardHistoryNavBar'),
    navBackWordTitle: document.getElementById('navBackWordTitle'),
    navDepthBadge: document.getElementById('navDepthBadge'),

    // 批次計數器與拼寫模式選單
    batchSizeSelect: document.getElementById('batchSizeSelect'),
    spellingOptinSelect: document.getElementById('spellingOptinSelect'),
    sessionCardIndex: document.getElementById('sessionCardIndex'),
    sessionTotalCount: document.getElementById('sessionTotalCount'),

    // 視圖切換
    flashcardView: document.getElementById('flashcardView'),
    spellingView: document.getElementById('spellingView'),
    dictionaryView: document.getElementById('dictionaryView'),
    
    // 36,000 字典速查組件
    dictSearchInput: document.getElementById('dictSearchInput'),
    dictClearBtn: document.getElementById('dictClearBtn'),
    dictSearchStats: document.getElementById('dictSearchStats'),
    dictScopeSelector: document.getElementById('dictScopeSelector'),
    dictTotalCountBadge: document.getElementById('dictTotalCountBadge'),
    dictList: document.getElementById('dictList'),

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
    spellingPromptFeedback: document.getElementById('spellingPromptFeedback'),
    spellingBatchProgress: document.getElementById('spellingBatchProgress'),
    spellingSkipBtn: document.getElementById('spellingSkipBtn')
  };
}

// ===================================================================
// 1. 初始化與儲存層 (Initialization & Storage)
// ===================================================================
function initApp() {
  initDomReferences();
  loadStoredData();
  loadSpellingConfig();
  buildCategoryPills();
  buildDictScopePills();
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

function loadSpellingConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SPELLING_OPTIN);
    if (saved && ['every_5', 'every_10', 'immediate', 'batch_end', 'off'].includes(saved)) {
      currentSpellingMode = saved;
    } else {
      currentSpellingMode = 'every_5';
    }
  } catch (e) {
    currentSpellingMode = 'every_5';
  }

  if (dom.spellingOptinSelect) {
    dom.spellingOptinSelect.value = currentSpellingMode;
  }
}

function changeSpellingOptin(mode) {
  if (!['every_5', 'every_10', 'immediate', 'batch_end', 'off'].includes(mode)) return;
  currentSpellingMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY_SPELLING_OPTIN, mode);
  } catch (e) {}

  const descriptions = {
    'every_5': '🎯 已切換為：每 5 張集中拼寫練習',
    'every_10': '🎯 已切換為：每 10 張集中拼寫練習',
    'immediate': '⚡ 已切換為：遇不熟/陌生立即引導拼寫',
    'batch_end': '🏁 已切換為：整批卡片結束時集中拼寫',
    'off': '🚫 已切換為：關閉拼寫（純刷卡速讀模式）'
  };

  showFeedbackBanner('good', descriptions[mode] || '拼寫練習模式已更新');
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
  pendingSpellingQueue = [];
  cardsEvaluatedInInterval = 0;
  isBatchSpellingActive = false;

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


/**
 * 結構化解析與美化中文釋義與常見搭配片語 (ECDICT 解析器)
 * 解決 ECDICT 原始資料中 || 符號與短語雜揉、多詞性擠壓的痛點
 */
function formatTranslationHtml(rawTrans) {
  if (!rawTrans) return '<div class="trans-text-body">（暫無中文釋義）</div>';

  let mainPart = rawTrans.trim();
  let phrasePart = '';

  // 1. 拆分 ECDICT 附帶的片語/短語區塊 (|| 開頭)
  if (mainPart.includes('||')) {
    const splits = mainPart.split('||');
    mainPart = splits[0].trim();
    phrasePart = splits.slice(1).join(' ').trim();
  }

  // 2. 檢查 phrasePart 是否在尾部附帶了第二詞性釋義 (如 v. 1. (使)分開)
  const secondaryPosMatch = phrasePart.match(/\s+([a-z]{1,4}\.\s*\d*.*)$/);
  if (secondaryPosMatch) {
    const posStr = secondaryPosMatch[1].trim();
    phrasePart = phrasePart.slice(0, secondaryPosMatch.index).trim();
    mainPart += ' ' + posStr;
  }

  // 3. 核心釋義結構化美化：標注序號與詞性切換
  let formattedMain = mainPart
    .replace(/\s+(\d+)\.\s*/g, ' <span class="trans-sense-badge">$1</span> ')
    .replace(/\b(v\.|adj\.|adv\.|n\.|prep\.|conj\.|vt\.|vi\.)\s*/g, ' <span class="trans-pos-pill">$1</span> ');

  // 4. 解析片語短語列表 (以中括號、斜線等符號分割)
  let phraseHtml = '';
  if (phrasePart) {
    const rawItems = phrasePart.split(/[\[\]\/]+/).map(s => s.trim()).filter(Boolean);
    const parsedPhrases = [];

    for (const item of rawItems) {
      // 嘗試拆分英文短語與中文解釋 (例如 "take part in參加" 或 "for my part至於我，對我來說")
      const match = item.match(/^([a-zA-Z\s\(\)\'\-\,\.\…\d]+)([\u4e00-\u9fa5].*)$/);
      if (match) {
        const en = match[1].trim();
        const zh = match[2].trim();
        parsedPhrases.push(`
          <div class="phrase-tag-item">
            <span class="p-en">${renderClickableSentence(en)}</span>
            <span class="p-zh">${zh}</span>
            <span class="chip-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(en)}')">🔊</span>
          </div>
        `);
      } else {
        parsedPhrases.push(`
          <div class="phrase-tag-item">
            <span class="p-zh">${item}</span>
          </div>
        `);
      }
    }

    if (parsedPhrases.length > 0) {
      phraseHtml = `
        <div class="trans-phrase-container">
          <span class="trans-phrase-title">📚 常見搭配／慣用片語：</span>
          <div class="trans-phrase-grid">
            ${parsedPhrases.join('')}
          </div>
        </div>
      `;
    }
  }

  return `
    <div class="trans-text-body">${formattedMain}</div>
    ${phraseHtml}
  `;
}

function renderCardBack(word) {
  if (!word) word = getCurrentWord();
  if (!word) return;

  const synonymsList = (word.synonyms || []).slice(0, 5);
  const antonymsList = (word.antonyms || []).slice(0, 5);
  const prefixList = (word.samePrefixWords || []).slice(0, 3);
  const suffixList = (word.sameSuffixWords || []).slice(0, 3);

  dom.cardBack.innerHTML = `
    <div class="card-face-scroll">
      <!-- 標題、音標、詞性與發音 (頂部列，不與中文釋義擠壓) -->
      <div class="back-header">
        <div class="back-word-group">
          <div class="back-word">${word.word}</div>
          <div class="back-phonetic-row">
            ${(word.partOfSpeech || []).map(pos => `<span class="pos-tag">${pos}</span>`).join('')}
            <span class="phonetic-text">${word.kkPhonetic || ''}</span>
          </div>
        </div>
        <button class="sentence-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.word)}')">
          🔊 朗讀單字
        </button>
      </div>

      <!-- 核心釋義與常見搭配片語區 -->
      <div class="detail-section translation-section">
        <div class="trans-box">
          ${formatTranslationHtml(word.translation)}
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
            <div class="example-en">${renderClickableSentence(word.exampleSentence, word.word)}</div>
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
            <div class="idiom-phrase">${renderClickableSentence(word.idiom.phrase)}：${word.idiom.translation}</div>
            ${word.idiom.exampleSentence ? `
              <div class="example-en" style="margin-top:4px; font-size:0.83rem; cursor:pointer;" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(word.idiom.exampleSentence)}')">
                "${renderClickableSentence(word.idiom.exampleSentence)}"
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
              <span style="font-size:0.75rem; color:var(--chalk-green); font-weight:600;">✨ 相似詞：</span>
              <div class="chips-grid">
                ${synonymsList.map(s => `
                  <span class="word-chip synonym" onclick="event.stopPropagation(); jumpToWordWithHistory(null, '${escapeQuotes(s)}')">
                    <span>${s}</span>
                    <span class="chip-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(s)}')">🔊</span>
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${antonymsList.length > 0 ? `
            <div style="margin-top:6px;">
              <span style="font-size:0.75rem; color:var(--chalk-pink); font-weight:600;">⚡ 相反詞：</span>
              <div class="chips-grid">
                ${antonymsList.map(a => `
                  <span class="word-chip antonym" onclick="event.stopPropagation(); jumpToWordWithHistory(null, '${escapeQuotes(a)}')">
                    <span>${a}</span>
                    <span class="chip-sound-btn" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(a)}')">🔊</span>
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

          <!-- 同字根家族延伸 (精選 3 實用例與個別字拆解) -->
          ${(word.etymology.rootFamily && word.etymology.rootFamily.length > 0) ? `
            <div class="family-examples-section">
              <div class="family-examples-title">
                🌱 同字根家族單字拆解（精選 3 例）：
              </div>
              <div class="family-examples-list">
                ${word.etymology.rootFamily.slice(0, 3).map(fam => `
                  <div class="family-example-card" onclick="event.stopPropagation(); jumpToWordWithHistory(null, '${escapeQuotes(fam.word)}')">
                    <div class="family-card-top">
                      <div class="family-word-name">
                        <span class="f-name">${fam.word}</span>
                        <span class="f-audio-tag" onclick="event.stopPropagation(); playPronunciation('${escapeQuotes(fam.word)}')">🔊 聽音</span>
                      </div>
                      <div class="family-meaning-text">${fam.meaning}</div>
                    </div>
                    ${fam.formula ? `
                      <div class="family-formula-text">
                        <span class="formula-label">🧩 拆解：</span>${fam.formula}
                      </div>
                    ` : ''}
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
          <div style="flex:1;">"${renderClickableSentence(word.exampleSentence, word.word)}"</div>
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

  // 2. 背面深度渲染 (Back Face)
  renderCardBack(word);

  // 3. 更新計數指示與歷史導航列
  if (dom.sessionCardIndex && dom.sessionTotalCount) {
    dom.sessionCardIndex.innerText = Math.min(currentIndex + 1, sessionQueue.length);
    dom.sessionTotalCount.innerText = sessionQueue.length;
  }
  updateHistoryNavBar();
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
// 4. 三大選項艾賓浩斯記憶法評估與 Opt-in / 間隔集中拼寫 (Requirement 3 & 10)
// ===================================================================

/**
 * 處理字卡評估選項：
 * 'familiar': 🟢 非常熟悉 (之後的字卡不再出現，直接跳下一張)
 * 'hesitate': 🟠 不熟/忘了 (將字卡往中間排序，按模式引導或集中拼寫)
 * 'stranger': 🔴 陌生 (將此字卡在1~2張卡片後排序，按模式引導或集中拼寫)
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
    cardsEvaluatedInInterval++;
    playChalkSuccessSound();
    updateStats();

    // 隊列為空 (整批卡片已刷完)
    if (sessionQueue.length === 0) {
      if (pendingSpellingQueue.length > 0 && currentSpellingMode !== 'off') {
        startBatchSpellingSession();
        return;
      }
      openBatchCompleteModal();
      return;
    }

    // 檢查是否達到集中間隔門檻 (例如每 5 張或每 10 張)
    const intervalLimit = currentSpellingMode === 'every_5' ? 5 : (currentSpellingMode === 'every_10' ? 10 : Infinity);
    if (cardsEvaluatedInInterval >= intervalLimit && pendingSpellingQueue.length > 0 && currentSpellingMode !== 'off') {
      startBatchSpellingSession();
      return;
    }

    triggerCardTransition('next');

    // 每累積掌握 10 個觸發成就獎章
    if (sessionMasteredCount > 0 && sessionMasteredCount % 10 === 0) {
      openMilestoneModal();
    }
  } else if (type === 'hesitate' || type === 'stranger') {
    // 隊列重排邏輯 (艾賓浩斯記憶法)
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

    cardsEvaluatedInInterval++;
    updateStats();

    // 根據 Opt-in 模式分流處理
    if (currentSpellingMode === 'off') {
      // 🚫 關閉拼寫：純刷卡模式，零中斷
      triggerCardTransition('next');
      return;
    }

    if (currentSpellingMode === 'immediate') {
      // ⚡ 即時模式：遇不熟/陌生立即引導拼寫
      pendingAssessment = {
        type: type,
        word: currentWord,
        isBatch: false
      };
      openSpellingPrompt(type, currentWord, false);
      return;
    }

    // 🎯 間隔集中模式 (every_5, every_10, batch_end)
    if (!pendingSpellingQueue.some(item => item.word.id === currentWord.id)) {
      pendingSpellingQueue.push({ type: type, word: currentWord });
    }

    const intervalLimit = currentSpellingMode === 'every_5' ? 5 : (currentSpellingMode === 'every_10' ? 10 : Infinity);

    if (cardsEvaluatedInInterval >= intervalLimit && pendingSpellingQueue.length > 0) {
      // 達到間隔門檻，啟動集中連續拼寫
      startBatchSpellingSession();
    } else {
      // 未達門檻，加入佇列並切換至下一張
      showFeedbackBanner('info', `📝 已加入集中拼寫清單（目前累積 ${pendingSpellingQueue.length} 詞）`);
      triggerCardTransition('next');
    }
  }
}

// ===================================================================
// 5. 即時與集中批次拼寫練習系統 (Guided & Batch Interval Spelling)
// ===================================================================

function startBatchSpellingSession() {
  if (pendingSpellingQueue.length === 0) return;
  isBatchSpellingActive = true;
  activeBatchSpellingIndex = 0;
  cardsEvaluatedInInterval = 0;
  loadBatchSpellingWord(0);
}

function loadBatchSpellingWord(idx) {
  if (!isBatchSpellingActive || idx >= pendingSpellingQueue.length) {
    finishAllBatchSpelling();
    return;
  }
  activeBatchSpellingIndex = idx;
  const currentItem = pendingSpellingQueue[idx];
  pendingAssessment = {
    type: currentItem.type,
    word: currentItem.word,
    isBatch: true,
    batchIndex: idx,
    batchTotal: pendingSpellingQueue.length
  };

  openSpellingPrompt(currentItem.type, currentItem.word, true);
}

function skipCurrentSpellingWord() {
  if (!isBatchSpellingActive) {
    closeSpellingPrompt(true);
    return;
  }
  const skippedWord = pendingAssessment && pendingAssessment.word ? pendingAssessment.word.word : '';
  showFeedbackBanner('info', `⏭️ 已跳過單字：${skippedWord}`);
  activeBatchSpellingIndex++;
  if (activeBatchSpellingIndex >= pendingSpellingQueue.length) {
    finishAllBatchSpelling();
  } else {
    loadBatchSpellingWord(activeBatchSpellingIndex);
  }
}

function finishAllBatchSpelling() {
  isBatchSpellingActive = false;
  pendingSpellingQueue = [];
  cardsEvaluatedInInterval = 0;
  pendingAssessment = null;

  if (dom.spellingPromptModal) {
    dom.spellingPromptModal.classList.remove('active');
  }
  if (dom.spellingBatchProgress) {
    dom.spellingBatchProgress.style.display = 'none';
  }
  if (dom.spellingSkipBtn) {
    dom.spellingSkipBtn.style.display = 'none';
  }

  showFeedbackBanner('good', '🎉 太棒了！本輪集中拼寫練習全部完成！');

  if (sessionQueue.length === 0) {
    openBatchCompleteModal();
  } else {
    triggerCardTransition('next');
  }
}

function openSpellingPrompt(type, word, isBatch = false) {
  if (!dom.spellingPromptModal) {
    initDomReferences();
  }
  if (!dom.spellingPromptModal) return;

  // 設置批次進度徽章與跳過按鈕
  if (dom.spellingBatchProgress) {
    if (isBatch && isBatchSpellingActive) {
      dom.spellingBatchProgress.style.display = 'inline-block';
      dom.spellingBatchProgress.innerText = `集中測驗 ${activeBatchSpellingIndex + 1} / ${pendingSpellingQueue.length}`;
    } else {
      dom.spellingBatchProgress.style.display = 'none';
    }
  }

  if (dom.spellingSkipBtn) {
    dom.spellingSkipBtn.style.display = isBatch ? 'inline-block' : 'none';
  }

  // 設置彈窗標題徽章
  if (type === 'hesitate') {
    dom.spellingPromptBadge.innerText = isBatch ? '🟠 不熟單字・集中拼寫' : '🟠 不熟 / 忘了・強化拼寫練習';
    dom.spellingPromptBadge.style.color = 'var(--chalk-orange)';
    dom.spellingPromptBadge.style.borderColor = 'var(--chalk-orange)';
  } else {
    dom.spellingPromptBadge.innerText = isBatch ? '🔴 陌生單字・集中拼寫' : '🔴 陌生生字・引導拼寫練習';
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
      if (isBatchSpellingActive) {
        activeBatchSpellingIndex++;
        if (activeBatchSpellingIndex >= pendingSpellingQueue.length) {
          finishAllBatchSpelling();
        } else {
          loadBatchSpellingWord(activeBatchSpellingIndex);
        }
      } else {
        finishSpellingPrompt();
      }
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
  if (isBatchSpellingActive) {
    // 使用者中途關閉集中測驗
    isBatchSpellingActive = false;
    if (dom.spellingBatchProgress) dom.spellingBatchProgress.style.display = 'none';
    if (dom.spellingSkipBtn) dom.spellingSkipBtn.style.display = 'none';
    pendingAssessment = null;
    showFeedbackBanner('info', '已暫停集中拼寫測驗，可隨時繼續刷卡或至選單調整');
    if (sessionQueue.length === 0) {
      openBatchCompleteModal();
    } else {
      triggerCardTransition('next');
    }
    return;
  }

  // 即時模式關閉
  pendingAssessment = null;
  triggerCardTransition('next');
}

function finishSpellingPrompt() {
  if (dom.spellingPromptModal) {
    dom.spellingPromptModal.classList.remove('active');
  }
  pendingAssessment = null;
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
  pendingSpellingQueue = [];
  cardsEvaluatedInInterval = 0;
  isBatchSpellingActive = false;
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
// 10. 36,000 字典全庫智能加權檢索系統 (36K Authority Dictionary System)
// ===================================================================

function buildDictScopePills() {
  if (!dom.dictScopeSelector) return;
  dom.dictScopeSelector.innerHTML = '';

  const scopes = [
    { id: 'all', label: '✨ 全庫 36,000 字' },
    { id: 'junior_2000', label: '🎒 國中 2000' },
    { id: 'senior_7000', label: '🏫 高中 7000' },
    { id: 'toefl', label: '📕 托福 10000' },
    { id: 'gre', label: '🎓 GRE 2000' },
    { id: 'business', label: '💼 商務多益 5000' },
    { id: 'reading_daily', label: '☕ 專欄 10000' }
  ];

  scopes.forEach(sc => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `dict-scope-pill ${currentDictScope === sc.id ? 'active' : ''}`;
    btn.innerText = sc.label;
    btn.onclick = () => {
      currentDictScope = sc.id;
      document.querySelectorAll('.dict-scope-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const val = dom.dictSearchInput ? dom.dictSearchInput.value : '';
      renderDictionaryList(val);
    };
    dom.dictScopeSelector.appendChild(btn);
  });
}

function clearDictSearch() {
  if (dom.dictSearchInput) {
    dom.dictSearchInput.value = '';
    if (dom.dictClearBtn) dom.dictClearBtn.style.display = 'none';
    dom.dictSearchInput.focus();
    renderDictionaryList('');
  }
}

function renderDictionaryList(query = '') {
  if (!dom.dictList) return;

  const rawQuery = (query || '').trim();
  const q = rawQuery.toLowerCase();

  if (dom.dictClearBtn) {
    dom.dictClearBtn.style.display = rawQuery.length > 0 ? 'flex' : 'none';
  }

  // 1. 根據分類範圍篩選候選池
  let candidatePool = vocabList;
  if (currentDictScope !== 'all') {
    candidatePool = vocabList.filter(item => item.category === currentDictScope);
  }

  if (dom.dictTotalCountBadge) {
    const scopeName = currentDictScope === 'all' ? '全庫 36,000 字' : ((typeof CATEGORY_DEFINITIONS !== 'undefined' && CATEGORY_DEFINITIONS[currentDictScope]?.shortLabel) || currentDictScope);
    dom.dictTotalCountBadge.innerText = `檢索範圍：${scopeName} (${candidatePool.length.toLocaleString()} 詞)`;
  }

  // 2. 無搜尋詞時：展示指引與精選探索
  if (!q) {
    const initialSample = candidatePool.slice(0, 40);
    if (dom.dictSearchStats) {
      dom.dictSearchStats.innerHTML = `
        <span>📚 <b>${candidatePool.length.toLocaleString()}</b> 筆深度字庫就緒</span>
        <span style="color:var(--chalk-dim);">請輸入單字拼寫、中文釋義或關鍵字</span>
      `;
    }

    dom.dictList.innerHTML = initialSample.map(item => renderDictCardHtml(item)).join('') + `
      <div style="text-align:center; padding:16px 10px; font-size:0.75rem; color:var(--chalk-faint);">
        💡 請在上方鍵入欲查詢的英文單字或中文釋義，系統將自 <b>36,000</b> 筆大字典庫中即時加權檢索！
      </div>
    `;
    return;
  }

  // 3. 智能加權計算引擎 (Exact Match > Prefix Match > Includes > Translation > Sentence)
  const scoredItems = [];
  const qLen = q.length;

  for (let i = 0; i < candidatePool.length; i++) {
    const item = candidatePool[i];
    const w = item.word.toLowerCase();
    const trans = (item.translation || '').toLowerCase();
    let score = 0;
    let matchType = '';

    if (w === q) {
      // 🥇 完全吻合 (最高優先級，置頂第一)
      score = 1000;
      matchType = '完全吻合';
    } else if (w.startsWith(q)) {
      // 🥈 字首吻合 (長度越短越優先)
      score = 800 - Math.min(100, (w.length - qLen) * 5);
      matchType = '字首相符';
    } else if (w.includes(q)) {
      // 🥉 單字包含
      score = 500 - Math.min(100, (w.length - qLen) * 2);
      matchType = '拼寫包含';
    } else if (trans.startsWith(q)) {
      // 🏅 中文開頭吻合
      score = 400;
      matchType = '釋義相符';
    } else if (trans.includes(q)) {
      // 🏅 中文包含
      score = 300;
      matchType = '釋義包含';
    } else if (qLen >= 3 && (item.exampleSentence || '').toLowerCase().includes(q)) {
      // 🎖️ 例句包含 (短詞不觸發，避免噪音)
      score = 100;
      matchType = '例句出現';
    }

    if (score > 0) {
      scoredItems.push({ item, score, matchType });
    }
  }

  // 降序排序
  scoredItems.sort((a, b) => b.score - a.score);

  // 統計橫幅更新
  if (dom.dictSearchStats) {
    dom.dictSearchStats.innerHTML = `
      <span>🔍 找到 <b>${scoredItems.length.toLocaleString()}</b> 筆符合結果</span>
      <span style="color:var(--chalk-cyan);">優先排序：完全吻合與字首命中</span>
    `;
  }

  if (scoredItems.length === 0) {
    dom.dictList.innerHTML = `
      <div style="text-align:center; padding:30px 10px; color:var(--chalk-dim);">
        <div style="font-size:2rem; margin-bottom:8px;">🔍</div>
        <div style="font-size:0.95rem; font-weight:bold; color:var(--chalk-yellow);">查無符合「${escapeQuotes(rawQuery)}」的字詞</div>
        <p style="font-size:0.78rem; margin-top:6px; color:var(--chalk-faint);">
          請檢查拼字是否正確，或切換上方分類範圍為「✨ 全庫 36,000 字」重新查詢。
        </p>
      </div>
    `;
    return;
  }

  // 渲染前 80 筆最相關結果
  const displaySlice = scoredItems.slice(0, 80);
  dom.dictList.innerHTML = displaySlice.map(entry => renderDictCardHtml(entry.item, entry.matchType, q)).join('') + (scoredItems.length > 80 ? `
    <div style="text-align:center; padding:12px; font-size:0.75rem; color:var(--chalk-faint);">
      已呈現最相關之首 80 筆結果（共 ${scoredItems.length.toLocaleString()} 筆，輸入更多字母即可精確定位）
    </div>
  ` : '');
}

function renderDictCardHtml(item, matchType = '', query = '') {
  const catDef = (typeof CATEGORY_DEFINITIONS !== 'undefined') ? CATEGORY_DEFINITIONS[item.category] : null;
  const catBadge = catDef ? catDef.shortLabel : (item.category || '');

  // 高亮關鍵字
  let wordDisplay = item.word;
  if (query && item.word.toLowerCase().includes(query)) {
    const reg = new RegExp(`(${query})`, 'gi');
    wordDisplay = item.word.replace(reg, '<span style="color:var(--chalk-yellow); text-decoration:underline;">$1</span>');
  }

  return `
    <div class="dict-item-card" onclick="jumpToWordWithHistory('${item.id}', '${escapeQuotes(item.word)}')">
      <div class="dict-card-left">
        <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
          <span class="dict-word-text">${wordDisplay}</span>
          <span class="dict-cat-tag">${catBadge}</span>
          <span style="font-size:0.74rem; color:var(--chalk-cyan);">${(item.partOfSpeech || []).join(' ')} ${item.kkPhonetic || ''}</span>
          ${matchType ? `<span style="font-size:0.65rem; color:var(--chalk-green); background:rgba(46,204,113,0.12); padding:1px 5px; border-radius:4px;">${matchType}</span>` : ''}
        </div>
        <div class="dict-word-zh">${item.translation}</div>
      </div>
      <div class="dict-action-group" onclick="event.stopPropagation();">
        <button class="dict-audio-btn" onclick="playPronunciation('${escapeQuotes(item.word)}')">
          🔊 聽音
        </button>
        <button class="dict-view-card-btn" onclick="jumpToWordWithHistory('${item.id}', '${escapeQuotes(item.word)}')">
          👉 字卡
        </button>
      </div>
    </div>
  `;
}

// ===================================================================
// 單字深層穿透查看與歷史導航棧 (Navigation Stack & Deep Linking)
// ===================================================================

// 常見英文不規則動詞/名詞/形容詞原型映射表 (常見詞形還原，確保例句點擊高命中率)
const IRREGULAR_INFLECTIONS = {
  'went': 'go', 'gone': 'go', 'was': 'be', 'were': 'be', 'been': 'be', 'am': 'be', 'is': 'be', 'are': 'be',
  'had': 'have', 'has': 'have', 'having': 'have',
  'did': 'do', 'does': 'do', 'doing': 'do', 'done': 'do',
  'said': 'say', 'saying': 'say',
  'made': 'make', 'making': 'make',
  'took': 'take', 'taken': 'take', 'taking': 'take',
  'came': 'come', 'coming': 'come',
  'saw': 'see', 'seen': 'see', 'seeing': 'see',
  'knew': 'know', 'known': 'know', 'knowing': 'know',
  'got': 'get', 'gotten': 'get', 'getting': 'get',
  'gave': 'give', 'given': 'give', 'giving': 'give',
  'found': 'find', 'finding': 'find',
  'thought': 'think', 'thinking': 'think',
  'told': 'tell', 'telling': 'tell',
  'became': 'become', 'becoming': 'become',
  'left': 'leave', 'leaving': 'leave',
  'felt': 'feel', 'feeling': 'feel',
  'brought': 'bring', 'bringing': 'bring',
  'began': 'begin', 'begun': 'begin', 'beginning': 'begin',
  'kept': 'keep', 'keeping': 'keep',
  'held': 'hold', 'holding': 'hold',
  'wrote': 'write', 'written': 'write', 'writing': 'write',
  'stood': 'stand', 'standing': 'stand',
  'heard': 'hear', 'hearing': 'hear',
  'meant': 'mean', 'meaning': 'mean',
  'met': 'meet', 'meeting': 'meet',
  'ran': 'run', 'running': 'run',
  'paid': 'pay', 'paying': 'pay',
  'sat': 'sit', 'sitting': 'sit',
  'spoke': 'speak', 'spoken': 'speak', 'speaking': 'speak',
  'lay': 'lie', 'lying': 'lie',
  'led': 'lead', 'leading': 'lead',
  'read': 'read', 'reading': 'read',
  'grew': 'grow', 'grown': 'grow', 'growing': 'grow',
  'lost': 'lose', 'losing': 'lose',
  'fell': 'fall', 'fallen': 'fall', 'falling': 'fall',
  'sent': 'send', 'sending': 'send',
  'built': 'build', 'building': 'build',
  'understood': 'understand', 'understanding': 'understand',
  'drew': 'draw', 'drawn': 'draw', 'drawing': 'draw',
  'broke': 'break', 'broken': 'break', 'breaking': 'break',
  'spent': 'spend', 'spending': 'spend',
  'rose': 'rise', 'risen': 'rise', 'rising': 'rise',
  'drove': 'drive', 'driven': 'drive', 'driving': 'drive',
  'bought': 'buy', 'buying': 'buy',
  'wore': 'wear', 'worn': 'wear', 'wearing': 'wear',
  'chose': 'choose', 'chosen': 'choose', 'choosing': 'choose',
  'swam': 'swim', 'swum': 'swim', 'swimming': 'swim',
  'ate': 'eat', 'eaten': 'eat', 'eating': 'eat',
  'caught': 'catch', 'catching': 'catch',
  'slept': 'sleep', 'sleeping': 'sleep',
  'threw': 'throw', 'thrown': 'throw', 'throwing': 'throw',
  'won': 'win', 'winning': 'win',
  'taught': 'teach', 'teaching': 'teach',
  'children': 'child', 'men': 'man', 'women': 'woman', 'feet': 'foot', 'teeth': 'tooth', 'mice': 'mouse', 'people': 'person',
  'better': 'good', 'best': 'good', 'worse': 'bad', 'worst': 'bad', 'more': 'many', 'most': 'many', 'less': 'little', 'least': 'little'
};

function findWordInDictionary(queryWord) {
  if (!queryWord) return null;
  const clean = queryWord.trim().toLowerCase().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  if (!clean) return null;

  // 1. 完全相符
  let match = vocabList.find(v => v.word.toLowerCase() === clean);
  if (match) return match;

  // 2. 移除所有格 's
  if (clean.endsWith("'s")) {
    const base = clean.slice(0, -2);
    match = vocabList.find(v => v.word.toLowerCase() === base);
    if (match) return match;
  }

  // 3. 不規則變形還原表
  if (IRREGULAR_INFLECTIONS[clean]) {
    const lemma = IRREGULAR_INFLECTIONS[clean];
    match = vocabList.find(v => v.word.toLowerCase() === lemma);
    if (match) return match;
  }

  // 4. 詞幹形態學規則推導 (複數、過去式、進行式、副詞、比較級)
  const candidates = [];

  // -ies -> -y (studies -> study)
  if (clean.endsWith('ies') && clean.length > 4) {
    candidates.push(clean.slice(0, -3) + 'y');
  }
  // -ied -> -y (studied -> study)
  if (clean.endsWith('ied') && clean.length > 4) {
    candidates.push(clean.slice(0, -3) + 'y');
  }
  // -ing (running -> run, dancing -> dance, walking -> walk)
  if (clean.endsWith('ing') && clean.length > 4) {
    const stem = clean.slice(0, -3);
    candidates.push(stem);
    candidates.push(stem + 'e');
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
      candidates.push(stem.slice(0, -1)); // running -> run, swimming -> swim
    }
  }
  // -ed (talked -> talk, liked -> like, stopped -> stop)
  if (clean.endsWith('ed') && clean.length > 3) {
    const stem = clean.slice(0, -2);
    candidates.push(stem);
    candidates.push(stem + 'e'); // liked -> like
    if (stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2]) {
      candidates.push(stem.slice(0, -1)); // stopped -> stop
    }
  }
  // -es (boxes -> box, watches -> watch, goes -> go)
  if (clean.endsWith('es') && clean.length > 3) {
    candidates.push(clean.slice(0, -2));
    candidates.push(clean.slice(0, -1)); // rules -> rule
  }
  // -s (lessons -> lesson, books -> book)
  if (clean.endsWith('s') && clean.length > 2 && !clean.endsWith('ss')) {
    candidates.push(clean.slice(0, -1));
  }
  // -ly (quickly -> quick, happily -> happy)
  if (clean.endsWith('ly') && clean.length > 3) {
    candidates.push(clean.slice(0, -2));
    if (clean.endsWith('ily')) {
      candidates.push(clean.slice(0, -3) + 'y');
    }
  }
  // -er / -est
  if (clean.endsWith('er') && clean.length > 3) {
    candidates.push(clean.slice(0, -2));
    candidates.push(clean.slice(0, -1));
  }
  if (clean.endsWith('est') && clean.length > 4) {
    candidates.push(clean.slice(0, -3));
    candidates.push(clean.slice(0, -2));
  }

  for (const c of candidates) {
    match = vocabList.find(v => v.word.toLowerCase() === c);
    if (match) return match;
  }

  // 5. 前綴匹配或包含 (長度相差 <= 2)
  match = vocabList.find(v => {
    const w = v.word.toLowerCase();
    return (w.startsWith(clean) || clean.startsWith(w)) && Math.abs(w.length - clean.length) <= 2;
  });
  if (match) return match;

  return null;
}

function renderClickableSentence(sentence, targetWord = '') {
  if (!sentence) return '';
  const cleanTarget = (targetWord || '').trim().toLowerCase();

  // 正則切分並匹配英文單詞（保留縮寫撇號，例如 don't, teacher's 等）
  return sentence.replace(/\b([a-zA-Z]+(?:'[a-zA-Z]+)?)\b/g, (match) => {
    const isTarget = cleanTarget && match.toLowerCase() === cleanTarget;
    const escaped = escapeQuotes(match);
    if (isTarget) {
      return `<span class="clickable-word target-word" title="當前主單字・點擊查看" onclick="event.stopPropagation(); jumpToWordWithHistory(null, '${escaped}')">${match}</span>`;
    } else {
      return `<span class="clickable-word" title="點擊查看「${match}」字卡" onclick="event.stopPropagation(); jumpToWordWithHistory(null, '${escaped}')">${match}</span>`;
    }
  });
}

function jumpToWordWithHistory(wordId, wordText = '') {
  // 1. 定位目標單字 (支援 ID 或智慧單詞/時態原型定位)
  let target = null;
  if (wordId) {
    target = vocabList.find(v => v.id === wordId);
  }
  if (!target && wordText) {
    target = findWordInDictionary(wordText);
  }

  if (!target) {
    const cleanWord = (wordText || '').trim();
    showFeedbackBanner('info', `📖 36,000 字庫中未找到「${cleanWord}」的獨立字卡，您可使用「📖 字典速查」查詢更多相關詞彙！`);
    return;
  }

  const currentWord = getCurrentWord();
  // 若點擊的正是目前正在檢視的單字
  if (currentWord && currentWord.id === target.id) {
    showFeedbackBanner('info', `💡 目前正在查看單字「${target.word}」`);
    return;
  }

  // 2. 記錄目前單字進度至歷史導航棧
  if (currentWord) {
    navigationHistory.push({
      word: currentWord,
      fromMode: currentMode,
      isFlipped: isCardFlipped,
      queueIndex: currentIndex
    });
  }

  // 3. 將目標單字動態插入當前隊列最前排
  sessionQueue.splice(currentIndex, 0, target);
  isCardFlipped = false;

  // 4. 切換為字卡視圖並渲染
  if (currentMode !== 'flashcard') {
    switchMode('flashcard');
  } else {
    renderCurrentCard();
  }

  updateHistoryNavBar();
  showFeedbackBanner('good', `🔍 已開啟「${target.word}」字卡！可點擊上方導航列隨時返回「${currentWord ? currentWord.word : ''}」`);
}

function popNavigationHistory() {
  if (navigationHistory.length === 0) return;

  const prevState = navigationHistory.pop();

  // 若原先插入的探索引導單字存在，自隊列中移除當前深入字
  if (sessionQueue.length > 1) {
    sessionQueue.splice(currentIndex, 1);
  }

  // 定位回到原單字
  const prevIdx = sessionQueue.findIndex(w => w.id === prevState.word.id);
  if (prevIdx !== -1) {
    currentIndex = prevIdx;
  }

  // 恢復翻面狀態與視圖模式
  if (prevState.fromMode === 'dictionary') {
    switchMode('dictionary');
  } else {
    if (currentMode !== 'flashcard') {
      switchMode('flashcard');
    }
    isCardFlipped = prevState.isFlipped;
    renderCurrentCard();
    if (dom.flashcard) {
      dom.flashcard.classList.toggle('is-flipped', isCardFlipped);
    }
  }

  updateHistoryNavBar();
}

function updateHistoryNavBar() {
  if (!dom.cardHistoryNavBar) return;

  if (navigationHistory.length > 0 && currentMode === 'flashcard') {
    const last = navigationHistory[navigationHistory.length - 1];
    dom.cardHistoryNavBar.style.display = 'flex';
    if (dom.navBackWordTitle) {
      dom.navBackWordTitle.innerText = `「${last.word.word}」`;
    }
    if (dom.navDepthBadge) {
      dom.navDepthBadge.innerText = `深層探索 (第 ${navigationHistory.length} 層)`;
    }
  } else {
    dom.cardHistoryNavBar.style.display = 'none';
  }
}

// 舊版 jumpToWord 相容別名
function jumpToWord(wordId) {
  jumpToWordWithHistory(wordId);
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

  if (mode === 'flashcard') {
    renderCurrentCard();
  }
  if (mode === 'dictionary') {
    const val = dom.dictSearchInput ? dom.dictSearchInput.value : '';
    renderDictionaryList(val);
  }

  updateHistoryNavBar();
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

    // 歷史導航快捷鍵：Esc 或在非輸入狀態下的 Backspace 可直接返回上一字
    const isEditingInput = (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    if ((e.key === 'Escape' || (!isEditingInput && e.key === 'Backspace')) && navigationHistory.length > 0) {
      e.preventDefault();
      popNavigationHistory();
      return;
    }

    if (currentMode !== 'flashcard') return;
    if (isEditingInput) return;

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

  // 字典即時搜尋監聽 (120ms 防抖動，確保 36,000 筆即打即查絲滑流暢)
  const dictSearchInput = document.getElementById('dictSearchInput');
  if (dictSearchInput) {
    dictSearchInput.addEventListener('input', (e) => {
      clearTimeout(dictDebounceTimer);
      dictDebounceTimer = setTimeout(() => {
        renderDictionaryList(e.target.value);
      }, 120);
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

// 全域導出函式供 HTML 行內 onclick 調用
window.openEtymologyGuide = openEtymologyGuide;
window.closeEtymologyGuide = closeEtymologyGuide;
window.popNavigationHistory = popNavigationHistory;
window.jumpToWordWithHistory = jumpToWordWithHistory;
window.clearDictSearch = clearDictSearch;
window.changeSpellingOptin = changeSpellingOptin;
window.skipCurrentSpellingWord = skipCurrentSpellingWord;
window.renderClickableSentence = renderClickableSentence;

// 頁面加載完成後啟動
document.addEventListener('DOMContentLoaded', initApp);
