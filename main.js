/**
 * 崩崩樂園 - Boom Boom Park (修正版)
 */

const { Engine, Runner, Bodies, Composite, Vector, Body } = Matter;

// --- 遊戲設定 ---
const COLORS = {
    background: '#F8F9FA',
    blocks: ['#B5EAD7', '#FFDAC1', '#E2F0CB', '#C7CEEA', '#FFB7B2'],
    ground: '#DEE2E6',
    particle: '#FFFFFF'
};

const GAME_STATE = {
    currentLevel: 1,
    ammo: 5,
    maxLevels: 10,
    isMuted: false,
    currentWeapon: 'normal',
    totalBlocks: 0,
    destroyedBlocks: 0,
    isInitialized: false
};

// --- 初始化物理環境 ---
let engine, world, runner, canvas, ctx;
let width, height;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let currentMousePos = { x: 0, y: 0 };
let dyingBodies = []; 
let particles = [];
let audioCtx;

function init() {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d');
    
    // 強制設定一次尺寸
    resize();
    
    engine = Engine.create();
    world = engine.world;
    
    // 監聽視窗縮放
    window.addEventListener('resize', resize);
    
    // 手機觸控防止滾動
    canvas.addEventListener('touchstart', (e) => {
        if(e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    setupInput();
    setupUI();
    loadLevel(1);
    
    runner = Runner.create();
    Runner.run(runner, engine);
    
    // 開始渲染迴圈
    render();
    GAME_STATE.isInitialized = true;
}

function resize() {
    // 優先使用 window 寬度確保手機上不會變 0
    width = canvas.width = window.innerWidth > 500 ? 500 : window.innerWidth;
    height = canvas.height = window.innerHeight;
}

// --- 關卡設計 ---
function loadLevel(num) {
    Composite.clear(world);
    dyingBodies = [];
    particles = [];
    GAME_STATE.currentLevel = num;
    GAME_STATE.ammo = num <= 3 ? 6 : num <= 7 ? 5 : 4;
    
    document.getElementById('destroy-progress').style.width = '0%';
    updateUI();

    // 地面 (稍微寬一點確保接住東西)
    const ground = Bodies.rectangle(width / 2, height - 20, width * 2, 40, { 
        isStatic: true,
        label: 'ground'
    });
    ground.render.fillStyle = COLORS.ground;
    Composite.add(world, ground);

    createBuilding(num);
}

function createBuilding(level) {
    const startX = width * 0.5;
    const startY = height - 40; // 地面上方
    const blockSize = 35;
    let blockData = [];

    // 關卡結構
    if (level === 1) { 
        for(let i=0; i<5; i++) blockData.push({x: startX, y: startY - i*blockSize, w: 40, h: 40});
    } else if (level === 2) { 
        for(let i=0; i<4; i++) {
            blockData.push({x: startX - 30, y: startY - i*blockSize, w: 30, h: 30});
            blockData.push({x: startX + 30, y: startY - i*blockSize, w: 30, h: 30});
        }
        blockData.push({x: startX, y: startY - 4 * blockSize, w: 90, h: 20});
    } else {
        // 隨機堆疊結構
        const stackCols = 2 + (level % 3);
        const stackRows = 3 + Math.floor(level / 2);
        for(let r=0; r<stackRows; r++) {
            for(let c=0; c<stackCols; c++) {
                blockData.push({
                    x: startX - (stackCols * 20) + c * 45, 
                    y: startY - r * 45, 
                    w: 35, h: 35
                });
            }
        }
    }

    GAME_STATE.totalBlocks = blockData.length;
    GAME_STATE.destroyedBlocks = 0;

    blockData.forEach(data => {
        const color = COLORS.blocks[Math.floor(Math.random() * COLORS.blocks.length)];
        const b = Bodies.rectangle(data.x, data.y - data.h/2, data.w, data.h, {
            restitution: 0.2,
            friction: 0.8,
            chamfer: { radius: 5 } // Matter.js 內建圓角物理
        });
        b.render.fillStyle = color;
        b.isBlock = true;
        Composite.add(world, b);
    });
}

// --- 渲染引擎 (核心修正) ---
function render() {
    // 1. 清除畫布
    ctx.clearRect(0, 0, width, height);
    
    // 2. 繪製瞄準線
    if (isDragging) {
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(dragStart.x, dragStart.y);
        ctx.lineTo(currentMousePos.x, currentMousePos.y);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 3. 取得所有物理身體並繪製
    const allBodies = Composite.allBodies(world);
    allBodies.forEach(body => {
        const { x, y } = body.position;
        
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(body.angle);
        
        // 設定美化質感
        ctx.fillStyle = body.render.fillStyle || '#CCC';
        ctx.globalAlpha = body.render.opacity !== undefined ? body.render.opacity : 1;
        ctx.shadowBlur = 8;
        ctx.shadowColor = 'rgba(0,0,0,0.08)';
        ctx.shadowOffsetY = 3;

        if (body.circleRadius) {
            ctx.beginPath();
            ctx.arc(0, 0, body.circleRadius, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 繪製方塊
            const vertices = body.vertices;
            ctx.beginPath();
            ctx.moveTo(vertices[0].x - x, vertices[0].y - y);
            for (let i = 1; i < vertices.length; i++) {
                ctx.lineTo(vertices[i].x - x, vertices[i].y - y);
            }
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // 偵測掉落 (地平線判定)
        if (!body.isStatic && y > height - 60 && !body.isDying && body.isBlock) {
            body.isDying = true;
            dyingBodies.push(body);
            GAME_STATE.destroyedBlocks++;
            updateProgress();
        }
    });

    // 4. 處理漸變消失
    for (let i = dyingBodies.length - 1; i >= 0; i--) {
        const b = dyingBodies[i];
        if (b.render.opacity === undefined) b.render.opacity = 1;
        b.render.opacity -= 0.02;
        if (b.render.opacity <= 0) {
            Composite.remove(world, b);
            dyingBodies.splice(i, 1);
        }
    }

    updateParticles();
    requestAnimationFrame(render);
}

// --- 其餘邏輯 ---
function setupInput() {
    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const start = (e) => {
        isDragging = true;
        dragStart = getPos(e);
        currentMousePos = { ...dragStart };
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    };

    const move = (e) => {
        if (isDragging) currentMousePos = getPos(e);
    };

    const end = () => {
        if (!isDragging) return;
        isDragging = false;
        if (GAME_STATE.ammo > 0) {
            const dx = dragStart.x - currentMousePos.x;
            const dy = dragStart.y - currentMousePos.y;
            const force = Math.min(Vector.magnitude({x: dx, y: dy}) * 0.004, 0.15);
            const angle = Math.atan2(dy, dx);
            shoot(dragStart.x, dragStart.y, angle, force);
        }
    };

    canvas.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    
    canvas.addEventListener('touchstart', (e) => start(e.touches[0]));
    window.addEventListener('touchmove', (e) => move(e.touches[0]));
    window.addEventListener('touchend', end);
}

function shoot(x, y, angle, force) {
    let radius = 12, color = '#FFB7B2', mass = 1;
    if (GAME_STATE.currentWeapon === 'heavy') { radius = 22; color = '#A2CFFE'; mass = 4; }
    if (GAME_STATE.currentWeapon === 'blast') { color = '#FFDAC1'; }

    const bullet = Bodies.circle(x, y, radius, {
        restitution: 0.4, mass: mass,
        render: { fillStyle: color }
    });
    
    Composite.add(world, bullet);
    Body.applyForce(bullet, bullet.position, { 
        x: Math.cos(angle) * force * mass, 
        y: Math.sin(angle) * force * mass 
    });

    GAME_STATE.ammo--;
    updateUI();
    playSound('shoot');

    if (GAME_STATE.currentWeapon === 'blast') {
        setTimeout(() => {
            if (bullet.world) {
                const blastPos = bullet.position;
                const bodies = Composite.allBodies(world);
                bodies.forEach(b => {
                    if (!b.isStatic && Vector.magnitude(Vector.sub(b.position, blastPos)) < 120) {
                        const f = Vector.mult(Vector.normalise(Vector.sub(b.position, blastPos)), 0.05);
                        Body.applyForce(b, b.position, f);
                    }
                });
                spawnParticles(blastPos.x, blastPos.y, color, 15);
                Composite.remove(world, bullet);
                shakeCamera();
                playSound('blast');
            }
        }, 800);
    }
}

function updateProgress() {
    const percent = (GAME_STATE.destroyedBlocks / GAME_STATE.totalBlocks) * 100;
    document.getElementById('destroy-progress').style.width = Math.min(percent, 100) + '%';
    if (percent >= 80) setTimeout(winLevel, 800);
}

function updateUI() {
    document.getElementById('level-num').innerText = GAME_STATE.currentLevel;
    document.getElementById('ammo-count').innerText = GAME_STATE.ammo;
}

function winLevel() {
    if (GAME_STATE.currentLevel >= GAME_STATE.maxLevels) {
        showOverlay('通關大吉！', '你拆毀了所有樂園！', '重新玩');
        GAME_STATE.currentLevel = 1;
    } else {
        showOverlay('大成功！', `第 ${GAME_STATE.currentLevel} 關已拆除`, '下一關');
        GAME_STATE.currentLevel++;
    }
    playSound('win');
}

function showOverlay(title, desc, btn) {
    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-desc').innerText = desc;
    document.getElementById('start-btn').innerText = btn;
    document.getElementById('overlay').classList.remove('hidden');
}

function setupUI() {
    document.getElementById('start-btn').onclick = () => {
        if (!audioCtx) initAudio();
        document.getElementById('overlay').classList.add('hidden');
        loadLevel(GAME_STATE.currentLevel);
    };

    document.querySelectorAll('.weapon-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.weapon-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            GAME_STATE.currentWeapon = btn.dataset.type;
        };
    });
}

// --- 音效與粒子 (簡化版確保執行) ---
function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
    if (!audioCtx || GAME_STATE.isMuted) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g); g.connect(audioCtx.destination);
    
    if(type === 'shoot') { osc.frequency.setValueAtTime(400, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1); }
    else if(type === 'win') { osc.frequency.setValueAtTime(500, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.2); }
    
    g.gain.setValueAtTime(0.1, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.start(); osc.stop(audioCtx.currentTime + 0.2);
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({ x, y, vx: (Math.random()-0.5)*8, vy: (Math.random()-0.5)*8, life: 1, color });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.03;
        if (p.life <= 0) particles.splice(i, 1);
        else {
            ctx.fillStyle = p.color; ctx.globalAlpha = p.life;
            ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}

function shakeCamera() {
    const el = document.getElementById('game-container');
    el.style.transform = 'translate(5px, 5px)';
    setTimeout(() => el.style.transform = 'translate(-5px, -5px)', 50);
    setTimeout(() => el.style.transform = 'translate(0,0)', 100);
}

init();
