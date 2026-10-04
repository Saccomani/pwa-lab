let dotnet = null;
let gpsWatchId = null;
let cameraStream = null;
let cameraVideo = null;
let cameraRaf = 0;
let cameraDetector = null;
let cameraReportedQr = false;
let cameraQrCanvas = null;
let cameraQrContext = null;
let cameraDecodeBusy = false;
let cameraLastDecodeAt = 0;
let microphoneStream = null;
let audioContext = null;
let microphoneAnalyser = null;
let microphoneTimer = 0;
let motionOrientationHandler = null;
let motionAccelerationHandler = null;
let motionLastSent = 0;
let wakeLock = null;
let sceneFrame = 0;
let sceneResources = null;
let sceneWorkload = 2;
let sceneStartedAt = 0;
let scenePreviousAt = 0;
let sceneFrameCount = 0;
let sceneSamples = [];
let sceneLastReportAt = 0;
let installedEventHandler = null;
let networkListenersAttached = false;

function errorLabel(error) {
    const name = error?.name || "Error";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Permissão negada ou bloqueada nas configurações do navegador.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Nenhuma câmera ou microfone compatível foi encontrado.";
    if (name === "NotReadableError" || name === "TrackStartError") return "O aparelho não conseguiu abrir o recurso; ele pode estar em uso por outro app.";
    if (name === "SecurityError") return "Recurso bloqueado neste contexto. Use HTTPS ou localhost e confira as permissões.";
    if (name === "NotSupportedError") return "Este recurso não é suportado neste navegador.";
    if (name === "AbortError") return "A ação foi cancelada.";
    return `${name} · verifique suporte, HTTPS e permissão do navegador.`;
}

function isInstalled() {
    return window.matchMedia?.("(display-mode: standalone)").matches === true || window.navigator.standalone === true;
}

export async function getCapabilities() {
    const canvas = document.createElement("canvas");
    let webgl = false;
    let webgl2 = false;
    try {
        webgl2 = !!canvas.getContext("webgl2");
        webgl = webgl2 || !!canvas.getContext("webgl") || !!canvas.getContext("experimental-webgl");
    } catch { }
    let qrDetector = false;
    if ("BarcodeDetector" in window) {
        try {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            qrDetector = formats.includes("qr_code");
        } catch { qrDetector = false; }
    }
    let localStorageAvailable = false;
    try { localStorageAvailable = !!window.localStorage; } catch { localStorageAvailable = false; }
    return {
        secureContext: window.isSecureContext === true,
        localStorage: localStorageAvailable,
        indexedDb: "indexedDB" in window,
        mediaDevices: !!navigator.mediaDevices?.getUserMedia,
        geolocation: !!navigator.geolocation,
        notifications: "Notification" in window,
        qrScanner: true,
        qrDetector,
        motion: "DeviceMotionEvent" in window || "DeviceOrientationEvent" in window,
        clipboard: !!navigator.clipboard,
        share: !!navigator.share,
        vibration: typeof navigator.vibrate === "function",
        webgl,
        webgl2,
        serviceWorker: "serviceWorker" in navigator,
        bluetooth: !!navigator.bluetooth,
        usb: !!navigator.usb,
        serial: !!navigator.serial,
        filePicker: typeof window.showOpenFilePicker === "function",
        wakeLock: !!navigator.wakeLock?.request,
        fullscreen: typeof document.documentElement.requestFullscreen === "function",
        storageEstimate: !!navigator.storage?.estimate,
        battery: typeof navigator.getBattery === "function",
        networkInformation: !!navigator.connection
    };
}

export async function getPwaStatus() {
    let serviceWorker = "Indisponível neste contexto";
    if ("serviceWorker" in navigator && window.isSecureContext) {
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (navigator.serviceWorker.controller) serviceWorker = "Ativo · controlando esta página";
            else if (registration?.active) serviceWorker = "Ativo · aguardando controlar a primeira carga";
            else if (registration) serviceWorker = "Registrado · aguardando ativação";
            else serviceWorker = "Ainda não registrado";
        } catch { serviceWorker = "Falha ao consultar"; }
    } else if ("serviceWorker" in navigator) {
        serviceWorker = "HTTPS necessário";
    }
    let connectionType = navigator.connection?.effectiveType || navigator.connection?.type || null;
    return { serviceWorker, online: navigator.onLine, installed: isInstalled(), connectionType };
}

export async function initialize(dotnetRef) {
    dotnet = dotnetRef;
    if (!networkListenersAttached) {
        window.addEventListener("online", onNetworkChange);
        window.addEventListener("offline", onNetworkChange);
        navigator.connection?.addEventListener?.("change", onNetworkChange);
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("pagehide", onPageHide);
        networkListenersAttached = true;
    }
    if (installedEventHandler === null) {
        installedEventHandler = () => dotnet?.invokeMethodAsync("OnSystemMessage", "PWA instalado pelo navegador.").catch(() => { });
        window.addEventListener("appinstalled", installedEventHandler);
    }
    return { capabilities: await getCapabilities(), ...(await getPwaStatus()) };
}

export function focusBenchHeading(heading) {
    if (!heading) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    heading.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
}

function onNetworkChange() {
    dotnet?.invokeMethodAsync("OnNetworkChanged", navigator.onLine, navigator.connection?.effectiveType || navigator.connection?.type || null).catch(() => { });
}

function onVisibilityChange() {
    if (document.visibilityState === "hidden") stopSensitiveAndHeavyWork();
}

function onPageHide() {
    stopSensitiveAndHeavyWork();
}

function stopSensitiveAndHeavyWork() {
    stopLocation();
    stopCamera();
    stopMicrophone();
    stopMotion();
    stopScene();
    releaseWakeLock();
    dotnet?.invokeMethodAsync("OnSystemMessage", "Recursos liberados ao sair ou ocultar a página.").catch(() => { });
}

export function localStorageWriteRead(key, value) {
    localStorage.setItem(key, value);
    return localStorage.getItem(key) ?? "";
}

export function localStorageRemove(key) {
    localStorage.removeItem(key);
}

export function readLocation(dotnetRef) {
    stopLocation();
    if (!window.isSecureContext) {
        dotnetRef.invokeMethodAsync("OnGpsError", "Localização exige HTTPS ou localhost.");
        return;
    }
    if (!navigator.geolocation) {
        dotnetRef.invokeMethodAsync("OnGpsError", "Geolocalização indisponível neste navegador.");
        return;
    }
    gpsWatchId = navigator.geolocation.watchPosition(position => {
        if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
        dotnetRef.invokeMethodAsync("OnGpsResult", position.coords.latitude, position.coords.longitude, position.coords.accuracy).catch(() => { });
    }, error => {
        if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
        gpsWatchId = null;
        let message = error.code === 1 ? "Permissão de localização negada." : error.code === 2 ? "A posição não está disponível agora." : "A consulta de localização expirou.";
        dotnetRef.invokeMethodAsync("OnGpsError", message).catch(() => { });
    }, { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 });
}

export function stopLocation() {
    if (gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
}

export async function startCamera(videoId, dotnetRef) {
    await stopCamera();
    if (!window.isSecureContext) return { ok: false, message: "Câmera exige HTTPS ou localhost." };
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, message: "Câmera indisponível neste navegador." };
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        cameraVideo = document.getElementById(videoId);
        if (!cameraVideo) throw new Error("A prévia da câmera não está montada.");
        cameraVideo.srcObject = cameraStream;
        cameraVideo.classList.add("stream-ready");
        await cameraVideo.play();
        cameraReportedQr = false;
        cameraQrCanvas = document.createElement("canvas");
        cameraQrCanvas.width = 360;
        cameraQrContext = cameraQrCanvas.getContext("2d", { willReadFrequently: true });
        cameraDecodeBusy = false;
        cameraLastDecodeAt = 0;
        if (!cameraQrContext) throw new Error("Canvas 2D indisponível para preparar o quadro QR.");
        cameraRaf = requestAnimationFrame(() => scanQrFrame(dotnetRef));
        return { ok: true, message: "Câmera ativa. ZXing.Net procura QR localmente; a imagem não sai do aparelho." };
    } catch (error) {
        await stopCamera();
        return { ok: false, message: errorLabel(error) };
    }
}

export function captureCameraPhoto() {
    if (!cameraStream || !cameraVideo || cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        throw new Error("Abra a câmera e aguarde a prévia antes de capturar a foto.");
    }
    const sourceWidth = cameraVideo.videoWidth;
    const sourceHeight = cameraVideo.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error("A câmera ainda não entregou um quadro para captura.");

    const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D indisponível para capturar a foto.");
    context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
}

async function scanQrFrame(dotnetRef) {
    if (!cameraStream || !cameraVideo || !cameraQrContext) return;
    const now = performance.now();
    if (!cameraReportedQr && !cameraDecodeBusy && cameraVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - cameraLastDecodeAt >= 260) {
        cameraDecodeBusy = true;
        cameraLastDecodeAt = now;
        try {
            const width = 360;
            const aspect = cameraVideo.videoWidth && cameraVideo.videoHeight ? cameraVideo.videoHeight / cameraVideo.videoWidth : 0.5625;
            const height = Math.max(1, Math.min(480, Math.round(width * aspect)));
            if (cameraQrCanvas.width !== width || cameraQrCanvas.height !== height) { cameraQrCanvas.width = width; cameraQrCanvas.height = height; }
            cameraQrContext.drawImage(cameraVideo, 0, 0, width, height);
            const rgba = new Uint8Array(cameraQrContext.getImageData(0, 0, width, height).data);
            const decoded = await dotnetRef.invokeMethodAsync("DecodeQrFrame", rgba, width, height);
            if (decoded && cameraStream) {
                cameraReportedQr = true;
                dotnetRef.invokeMethodAsync("OnCameraMessage", "QR lido pelo decodificador local. A câmera continua ativa até você pará-la.", decoded).catch(() => { });
            }
        } catch { }
        finally { cameraDecodeBusy = false; }
    }
    if (cameraStream) cameraRaf = requestAnimationFrame(() => scanQrFrame(dotnetRef));
}

export async function decodeQrImage(imageId, dotnetRef) {
    try {
        const image = document.getElementById(imageId);
        if (!image) return { message: "QR de amostra não está montado." };
        if (!image.complete) await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
        await image.decode?.();
        const width = Math.min(360, image.naturalWidth || 360);
        const height = Math.max(1, Math.min(480, Math.round(width * (image.naturalHeight / image.naturalWidth))));
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return { message: "Canvas 2D indisponível para ler a amostra." };
        context.fillStyle = "#fff"; context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
        const decoded = await dotnetRef.invokeMethodAsync("DecodeQrFrame", rgba, width, height);
        if (!decoded) return { message: "Não foi possível decodificar a amostra QR." };
        await dotnetRef.invokeMethodAsync("OnCameraMessage", "QR de demonstração decodificado localmente, sem abrir link.", decoded);
        return { message: "Amostra QR decodificada com sucesso pelo ZXing.Net em WebAssembly." };
    } catch (error) {
        return { message: errorLabel(error) };
    }
}

export async function stopCamera() {
    if (cameraRaf) cancelAnimationFrame(cameraRaf);
    cameraRaf = 0;
    if (cameraVideo) {
        cameraVideo.pause();
        cameraVideo.srcObject = null;
        cameraVideo.classList.remove("stream-ready");
    }
    cameraVideo = null;
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    cameraDetector = null;
    cameraQrCanvas = null;
    cameraQrContext = null;
    cameraDecodeBusy = false;
    cameraReportedQr = false;
}

export async function showLocalNotification(dotnetRef) {
    if (!window.isSecureContext) return { message: "Notificação exige HTTPS ou localhost." };
    if (!("Notification" in window)) return { message: "Notificações não são suportadas neste navegador." };
    try {
        let permission = Notification.permission;
        if (permission === "default") permission = await Notification.requestPermission();
        if (permission !== "granted") return { message: permission === "denied" ? "Permissão negada; altere-a nas configurações do site." : "Permissão não concedida." };
        if (!("serviceWorker" in navigator)) return { message: "Notificação persistente requer service worker neste navegador." };
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("DeviceLab · teste local", {
            body: "Notificação local confirmada. Nenhuma mensagem remota foi enviada.",
            icon: "icon-192.png",
            badge: "icon-192.png",
            tag: "devicelab-local-test",
            renotify: false
        });
        return { message: "Notificação exibida pelo service worker local." };
    } catch (error) {
        return { message: errorLabel(error) };
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("devicelab-local", 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains("samples")) database.createObjectStore("samples", { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB indisponível."));
    });
}

function runTransaction(database, mode, operation) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction("samples", mode);
        const request = operation(transaction.objectStore("samples"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Falha no IndexedDB."));
        transaction.onabort = () => reject(transaction.error || new Error("Transação cancelada."));
    });
}

export async function indexedDbPutRead(id, value) {
    const database = await openDatabase();
    try {
        await runTransaction(database, "readwrite", store => store.put({ id, value, updatedAt: new Date().toISOString() }));
        const record = await runTransaction(database, "readonly", store => store.get(id));
        return record?.value ?? "Registro não encontrado.";
    } finally { database.close(); }
}

export async function indexedDbRead(id) {
    const database = await openDatabase();
    try {
        const record = await runTransaction(database, "readonly", store => store.get(id));
        return record?.value ?? null;
    } finally { database.close(); }
}

export async function indexedDbDelete(id) {
    const database = await openDatabase();
    try { await runTransaction(database, "readwrite", store => store.delete(id)); }
    finally { database.close(); }
}

export async function startMicrophone(dotnetRef) {
    await stopMicrophone();
    if (!window.isSecureContext) return { ok: false, message: "Microfone exige HTTPS ou localhost." };
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, message: "Microfone indisponível neste navegador." };
    try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        audioContext = new AudioContext();
        if (audioContext.state === "suspended") await audioContext.resume();
        microphoneAnalyser = audioContext.createAnalyser();
        microphoneAnalyser.fftSize = 256;
        audioContext.createMediaStreamSource(microphoneStream).connect(microphoneAnalyser);
        const values = new Uint8Array(microphoneAnalyser.fftSize);
        microphoneTimer = window.setInterval(() => {
            if (!microphoneAnalyser) return;
            microphoneAnalyser.getByteTimeDomainData(values);
            let sum = 0;
            for (let i = 0; i < values.length; i++) { const normalized = (values[i] - 128) / 128; sum += normalized * normalized; }
            const rms = Math.sqrt(sum / values.length);
            dotnetRef.invokeMethodAsync("OnMicLevel", Math.min(100, Math.round(rms * 320))).catch(() => { });
        }, 120);
        return { ok: true, message: "Microfone ativo · nível local sem gravação." };
    } catch (error) {
        await stopMicrophone();
        return { ok: false, message: errorLabel(error) };
    }
}

export async function stopMicrophone() {
    if (microphoneTimer) clearInterval(microphoneTimer);
    microphoneTimer = 0;
    microphoneAnalyser = null;
    if (microphoneStream) microphoneStream.getTracks().forEach(track => track.stop());
    microphoneStream = null;
    if (audioContext) { try { await audioContext.close(); } catch { } }
    audioContext = null;
}

export async function startMotion(dotnetRef) {
    await stopMotion();
    if (!("DeviceOrientationEvent" in window) && !("DeviceMotionEvent" in window)) return { ok: false, message: "Sensores de orientação e movimento indisponíveis neste navegador." };
    try {
        if (typeof window.DeviceMotionEvent?.requestPermission === "function") {
            const permission = await window.DeviceMotionEvent.requestPermission();
            if (permission !== "granted") return { ok: false, message: "Permissão de movimento não concedida." };
        }
        if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
            const permission = await window.DeviceOrientationEvent.requestPermission();
            if (permission !== "granted") return { ok: false, message: "Permissão de orientação não concedida." };
        }
        motionOrientationHandler = event => {
            if (performance.now() - motionLastSent < 120) return;
            motionLastSent = performance.now();
            dotnetRef.invokeMethodAsync("OnMotion", event.alpha, event.beta, event.gamma, null, null, null).catch(() => { });
        };
        motionAccelerationHandler = event => {
            if (performance.now() - motionLastSent < 120) return;
            motionLastSent = performance.now();
            dotnetRef.invokeMethodAsync("OnMotion", null, null, null, event.accelerationIncludingGravity?.x ?? null, event.accelerationIncludingGravity?.y ?? null, event.accelerationIncludingGravity?.z ?? null).catch(() => { });
        };
        window.addEventListener("deviceorientation", motionOrientationHandler);
        window.addEventListener("devicemotion", motionAccelerationHandler);
        return { ok: true, message: "Sensores ativos; valores variam conforme o hardware exposto." };
    } catch (error) {
        await stopMotion();
        return { ok: false, message: errorLabel(error) };
    }
}

export async function stopMotion() {
    if (motionOrientationHandler) window.removeEventListener("deviceorientation", motionOrientationHandler);
    if (motionAccelerationHandler) window.removeEventListener("devicemotion", motionAccelerationHandler);
    motionOrientationHandler = null;
    motionAccelerationHandler = null;
}

export async function copyClipboard(value) {
    if (!navigator.clipboard?.writeText) throw new DOMException("Clipboard exige HTTPS ou não está disponível.", "NotSupportedError");
    await navigator.clipboard.writeText(value);
}

export async function readClipboard() {
    if (!navigator.clipboard?.readText) throw new DOMException("Leitura de clipboard indisponível neste navegador.", "NotSupportedError");
    return await navigator.clipboard.readText();
}

export async function shareDemo() {
    if (!navigator.share) return "Web Share não está disponível neste navegador.";
    try {
        await navigator.share({ title: "DeviceLab", text: "Estou explorando recursos do meu navegador com o DeviceLab.", url: location.href });
        return "Folha de compartilhamento aberta; o destino foi escolhido por você.";
    } catch (error) {
        return error?.name === "AbortError" ? "Compartilhamento cancelado." : errorLabel(error);
    }
}

export async function toggleFullscreen() {
    if (!document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) throw new DOMException("Tela cheia não está disponível.", "NotSupportedError");
        await document.documentElement.requestFullscreen();
    } else {
        await document.exitFullscreen();
    }
    return !!document.fullscreenElement;
}

export async function toggleWakeLock() {
    if (wakeLock && !wakeLock.released) { await releaseWakeLock(); return { ok: false, message: "Wake Lock liberado." }; }
    if (!navigator.wakeLock?.request) return { ok: false, message: "Wake Lock não está disponível neste navegador." };
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
            wakeLock = null;
            dotnet?.invokeMethodAsync("OnSystemMessage", "Wake Lock liberado pelo navegador.").catch(() => { });
        }, { once: true });
        return { ok: true, message: "Wake Lock ativo enquanto o navegador permitir." };
    } catch (error) { return { ok: false, message: errorLabel(error) }; }
}

export async function releaseWakeLock() {
    if (wakeLock && !wakeLock.released) { try { await wakeLock.release(); } catch { } }
    wakeLock = null;
}

export function vibrate() {
    if (typeof navigator.vibrate !== "function") return "Vibração não é suportada neste navegador ou aparelho.";
    const result = navigator.vibrate([100, 70, 100]);
    return result ? "Padrão curto enviado ao aparelho." : "O navegador não iniciou a vibração.";
}

const cubeFaces = [
    { color: [0.22, 0.84, 0.79], points: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
    { color: [0.46, 0.42, 0.98], points: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
    { color: [0.21, 0.62, 0.98], points: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]] },
    { color: [0.98, 0.36, 0.68], points: [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]] },
    { color: [0.98, 0.64, 0.31], points: [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]] },
    { color: [0.26, 0.79, 0.56], points: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] }
];

function buildCubeVertices() {
    const values = [];
    for (const face of cubeFaces) {
        for (const index of [0, 1, 2, 0, 2, 3]) values.push(...face.points[index], ...face.color);
    }
    return new Float32Array(values);
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || "Falha ao compilar shader WebGL.";
        gl.deleteShader(shader);
        throw new Error(message);
    }
    return shader;
}

function createSceneProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, `
        precision mediump float;
        attribute vec3 aPosition;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uAspect;
        varying vec3 vColor;
        void main() {
            float ax = uTime * 0.53;
            float ay = uTime * 0.71;
            vec3 p = aPosition;
            float cy = cos(ay); float sy = sin(ay);
            p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
            float cx = cos(ax); float sx = sin(ax);
            p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
            float depth = p.z + 3.8;
            gl_Position = vec4(p.x * 1.55 / uAspect, p.y * 1.55, (depth - 3.8) * 0.24, 1.0);
            vColor = aColor;
        }
    `);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform float uTime;
        uniform float uLoad;
        varying vec3 vColor;
        void main() {
            float pulse = 0.78 + 0.22 * sin(uTime * 1.7);
            float detail = 0.0;
            for (int i = 0; i < 12; i++) {
                if (float(i) < uLoad) detail += abs(sin(float(i) * 0.71 + uTime * 0.8)) * 0.003;
            }
            gl_FragColor = vec4(vColor * (pulse + detail), 1.0);
        }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Falha ao conectar o programa WebGL.");
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    return program;
}

function resizeScene(canvas, gl) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * scale));
    const height = Math.max(1, Math.floor(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
}

export function startScene(canvasId, dotnetRef, workload = 2) {
    stopScene();
    const canvas = document.getElementById(canvasId);
    if (!canvas) return { ok: false, message: "Canvas da cena não está disponível." };
    let gl = null;
    try { gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "high-performance" }) || canvas.getContext("experimental-webgl"); }
    catch { gl = null; }
    if (!gl) return { ok: false, message: "WebGL indisponível; a cena não iniciou." };
    try {
        const program = createSceneProgram(gl);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, buildCubeVertices(), gl.STATIC_DRAW);
        gl.useProgram(program);
        const position = gl.getAttribLocation(program, "aPosition");
        const color = gl.getAttribLocation(program, "aColor");
        gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(color);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
        gl.enable(gl.DEPTH_TEST);
        gl.clearColor(0.035, 0.055, 0.105, 1);
        sceneResources = { canvas, gl, program, buffer, uTime: gl.getUniformLocation(program, "uTime"), uAspect: gl.getUniformLocation(program, "uAspect"), uLoad: gl.getUniformLocation(program, "uLoad") };
        sceneWorkload = Math.max(0, Math.min(12, Number(workload) || 0));
        sceneStartedAt = performance.now(); scenePreviousAt = 0; sceneFrameCount = 0; sceneSamples = []; sceneLastReportAt = 0;
        const render = now => {
            if (!sceneResources) return;
            resizeScene(canvas, gl);
            const delta = scenePreviousAt ? now - scenePreviousAt : 0;
            scenePreviousAt = now;
            if (delta > 0 && delta < 1000) sceneSamples.push({ at: now, delta });
            sceneSamples = sceneSamples.filter(sample => now - sample.at <= 1000);
            sceneFrameCount++;
            const rect = canvas.getBoundingClientRect();
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.uniform1f(sceneResources.uTime, (now - sceneStartedAt) / 1000);
            gl.uniform1f(sceneResources.uAspect, Math.max(0.6, rect.width / Math.max(rect.height, 1)));
            gl.uniform1f(sceneResources.uLoad, sceneWorkload);
            gl.drawArrays(gl.TRIANGLES, 0, 36);
            if (!sceneLastReportAt || now - sceneLastReportAt >= 650) {
                const rollingMs = sceneSamples.reduce((sum, sample) => sum + sample.delta, 0);
                const fps = rollingMs > 0 ? sceneSamples.length * 1000 / rollingMs : 0;
                const elapsed = Math.max(1, now - sceneStartedAt);
                const average = sceneFrameCount * 1000 / elapsed;
                const frameMs = sceneSamples.length ? rollingMs / sceneSamples.length : 0;
                dotnetRef.invokeMethodAsync("OnSceneMetrics", fps, average, frameMs, sceneFrameCount).catch(() => { });
                sceneLastReportAt = now;
            }
            sceneFrame = requestAnimationFrame(render);
        };
        sceneFrame = requestAnimationFrame(render);
        window.addEventListener("resize", onSceneResize);
        return { ok: true, message: "Cena WebGL ativa; FPS calculado dos quadros observados no canvas." };
    } catch (error) {
        stopScene();
        return { ok: false, message: error?.message || errorLabel(error) };
    }
}

function onSceneResize() {
    if (sceneResources) resizeScene(sceneResources.canvas, sceneResources.gl);
}

export function setSceneWorkload(value) {
    sceneWorkload = Math.max(0, Math.min(12, Number(value) || 0));
}

export function stopScene() {
    if (sceneFrame) cancelAnimationFrame(sceneFrame);
    sceneFrame = 0;
    window.removeEventListener("resize", onSceneResize);
    if (sceneResources) {
        try { sceneResources.gl.deleteBuffer(sceneResources.buffer); sceneResources.gl.deleteProgram(sceneResources.program); }
        catch { }
        sceneResources = null;
    }
}
