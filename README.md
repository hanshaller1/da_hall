# DA HALL – Stereo Ambient Reverb

Ein hochwertiges Ambient-Reverb als Web-App, inspiriert von Multi-Mode-Ambient-Pedalen wie dem Walrus Audio Slöer.
Alles läuft lokal im Browser (Web Audio API, AudioWorklet). Es gibt keine Abhängigkeiten, keinen Build-Schritt und keinen Upload.

> DA HALL ist ein eigenständiges Projekt und steht in keiner Verbindung zu Walrus Audio.

## Starten

```bash
npm start          # http://localhost:8080
```

Alternativ funktioniert jeder statische Webserver, z. B. `python3 -m http.server 8080`.
Ein direktes Öffnen per `file://` funktioniert nicht, weil Browser AudioWorklets nur über `http(s)` oder `localhost` laden.
Für GitHub Pages reicht es, den Branch als Pages-Quelle einzustellen.

Unterstützt werden aktuelle Versionen von Chrome, Edge, Firefox und Safari.

## Bedienung

### Pedal

| Regler | Funktion |
|---|---|
| **Decay** | Nachhallzeit 0,4–40 s (frequenzabhängig, siehe *Damping*) |
| **Filter** | Bipolar: links Tiefpass bis 300 Hz, Mitte neutral, rechts Hochpass bis 2,5 kHz |
| **Depth** | Modulationstiefe der 16 Delay-Linien, von glasklar bis chorusartig |
| **Mix** | Bis zur Mitte bleibt das Direktsignal auf voller Lautstärke, danach wird es leiser (Wet bleibt voll) |
| **Mode** | Dark · Rise · Dream · Rain · Light |
| **X / Y** | Modusabhängige Fader (siehe unten) |
| **Stretch** | Zieht den Aufbau des Halls in die Länge („Bloom“ bis ca. 2,7 s) |
| **Width** | Stereobreite der Fahne: Narrow / Medium / Wide |
| **On/Off** | Bypass, wahlweise mit Trails |
| **Sustain** | Friert die Fahne unendlich ein. Kurz treten = umschalten, lang halten = nur solange gedrückt |

### Modi

| Modus | Charakter | X | Y |
|---|---|---|---|
| **Dark** | Dunkler Hall mit Sub-Oktave | Pegel der tiefen Oktave | Intervall (−5, −7, −12, −24 HT) |
| **Rise** | Hall schwillt nach jedem Anschlag an (Auto-Swell) | Anschwellzeit 50 ms–4 s | Wie stark das Direktsignal mitschwillt |
| **Dream** | Latch-Pad: hält, bis du neu anschlägst, dann übernimmt das neue Pad | Vibrato-Tiefe | Vibrato-Rate 0,5–9 Hz |
| **Rain** | Diffuse Ping-Pong-Delays tropfen in den Hall | Delay-Zeit 40 ms–1,2 s (Tap-Tempo) | Wiederholungen |
| **Light** | Shimmer: Pitch-Rückkopplung in der Fahne | Shimmer-Anteil | Intervall (+5, +7, +12, +19, +24 HT) |

### Zusätzliche Parameter („Rückseite“)

- **Raum:** Pre-Delay (0–500 ms), Size (35–160 %), Diffusion, Damping (HF-Decay-Verhältnis)
- **Klang:** Mod Rate, Low Cut (20–800 Hz), Lo-Fi (Bandbreite, Sättigung, Wow & Flutter)
- **Dynamik:** Duck (Hall weicht zurück, solange du spielst), Trigger (Anschlagempfindlichkeit für Rise und Dream)
- **Pegel:** Input und Output (±24 dB / +12 dB)
- **Eingang:** Stereo, Mono L, Mono R oder Summe. Wichtig bei Audio-Interfaces mit Gitarre auf Kanal 1.
- **Trails**, **Kill Dry** (für Parallel-Effektwege), **Hall leeren**

### Quellen & Export

- **Demo:** synthetische Gitarre (Karplus-Strong) mit den Mustern Arpeggio, Akkorde, Staccato und Impuls
- **Datei:** beliebige Audiodatei per Auswahl oder Drag & Drop
- **Live-Eingang:** Audio-Interface, Synth/Drum-Machine per USB, Mikrofon. **Kopfhörer benutzen!** Details unten.
- **Aufnehmen:** schneidet den Live-Ausgang mit (WebM/Opus)
- **Als WAV rendern:** rendert Demo oder Datei offline inklusive vollständiger Hallfahne als 24-Bit-WAV

### Live-Eingang: Interface, Syntakt & Co.

Jedes Gerät, das dein Betriebssystem als Audioeingang kennt, lässt sich verwenden: USB-Audio-Interfaces,
class-compliant Synths und Drum-Machines (z. B. ein Elektron Syntakt im USB-Audio-Modus), Mischpulte mit USB, Mikrofone.

- **Eingangsgerät:** Auswahl im Tab „Live-Eingang“. Vor der ersten Freigabe zeigen Browser keine Gerätenamen; dafür gibt es „Gerätenamen anzeigen“. Die letzte Wahl wird gemerkt.
- **Kanäle:** Stereopaare (1+2, 3+4, …) oder ein einzelner Kanal, der auf beide Seiten gelegt wird. Gitarre an Eingang 1 → „Kanal 1 (Mono)“. Lässt sich während des Spielens umschalten.
- **Abtastrate:** Der Audio-Kontext übernimmt automatisch die Rate des Geräts (z. B. 48 kHz). So entfällt das Resampling, was Latenz spart, und Firefox funktioniert überhaupt erst damit.
- **Ausgabegerät:** In Chrome und Edge kann der Ausgang direkt auf ein Interface gelegt werden, z. B. um den Hall wieder aufzunehmen.
- **Hotplug:** Neu angeschlossene Geräte erscheinen sofort. Wird das aktive Gerät getrennt, stoppt der Eingang mit einem Hinweis.
- **Direct Monitoring:** Hört dein Interface das Eingangssignal schon selbst ab, schalte „Kill Dry“ ein. Sonst hörst du das trockene Signal doppelt und leicht verzögert.
- Echo-Unterdrückung, Rauschfilter und automatische Pegelanpassung des Browsers sind abgeschaltet.

Grenzen:
- **Kanalzahl:** Die meisten Browser (insbesondere Chrome) liefern pro Gerät nur die ersten zwei Kanäle. Bei Mehrkanal-Interfaces oder Overbridge-Mehrspur kommen also die Kanäle 1/2 bzw. die Summe an. Die Kanalwahl bietet automatisch alles an, was der Browser tatsächlich liefert.
- **Sichere Verbindung nötig:** Der Eingang funktioniert nur über `https://` oder `http://localhost`.
- **Veröffentlichte claude.ai-Version:** Dort gibt es keinen Eingang, weil Seiten auf claude.ai keinen Mikrofon- oder Interface-Zugriff bekommen.

### Presets

Zehn Werkspresets. Eigene Presets werden im Browser gespeichert (localStorage) und lassen sich als JSON exportieren und importieren.
„Link kopieren“ speichert alle Einstellungen in der URL (`#p…`).

### Tastatur

`B` oder `Leertaste` Bypass · `S` Sustain (halten = momentan) · `1`–`5` Modus · `P` Start/Stopp ·
auf Reglern: Pfeiltasten, `Shift` = fein, `Pos1`/`Ende`, Doppelklick = Standardwert

## DSP-Architektur

Die gesamte Signalverarbeitung steckt in `js/audio/reverb-processor.js` (AudioWorkletProcessor):

```
Input ─┬─► Dry (Rise: 3 ms Lookahead + Swell)
       └─► Send ─► Dark: Sub-Oktave ─► Rain: diffundierendes Ping-Pong-Delay
                 ─► Light: Shimmer-Feedback ─► Dream: Latch-Delay
                 ─► Pre-Delay ─► Stretch (24 Taps + 2 modulierte Allpässe)
                 ─► Eingangs-Diffusion (4 Allpässe/Kanal)
                 ─► 16-Kanal-Feedback-Delay-Network
                 ─► Vibrato / Wow & Flutter ─► Lo-Fi ─► SVF-Filter ─► Ducking ─► Width ─► Mix
```

- **FDN:** 16 Delay-Linien (30–108 ms × Size), orthogonale Hadamard-Matrix (schnelle Walsh-Hadamard-Transformation), Hermite-interpolierte Modulation mit 16 dekorrelierten LFOs
- **Decay:** Feedback-Gains aus der RT60-Formel je Linienlänge. Frequenzabhängige Dämpfung nach Jot (One-Pole mit DC-Gain = g, Nyquist-Gain = g_hf), dazu ein DC-Blocker in der Schleife
- **Sustain:** Gains → 1, Dämpfung aus, Eingang zu. Die Schleife ist dann verlustfrei und hält die Fahne unbegrenzt
- **Pitch-Shifting:** granularer Shifter mit zwei leistungskomplementär überblendeten Leseköpfen
- **Stabilität:** Shimmer-AGC, weicher Clip in der Schleife, Soft-Limiter am Ausgang, NaN-Schutz
- **Parameter-Glättung:** Gains pro Sample, Koeffizienten im 32-Sample-Raster, Decay in der Log-Domäne
- **CPU:** ca. 6–9 % eines Kerns bei 48 kHz (gemessen in Node/V8)

## Tests

```bash
npm test
```

Die Tests laden den Worklet-Prozessor in Node (mit simulierten Worklet-Globals) und prüfen unter anderem RT60-Genauigkeit,
Stabilität aller Modi bei Extremwerten, Shimmer-Runaway, Sustain, Bypass/Trails, Kill Dry, Eingangsrouting,
Rise-Swell, Dream-Latch und verschiedene Abtastraten.

## Projektstruktur

```
index.html              Oberfläche
css/style.css           Gestaltung (Pedal, Panels, responsiv)
js/main.js              Zustand, Bedienlogik, Presets, Transport
js/params.js            Parameter-Definitionen und Mapping auf DSP-Einheiten
js/presets.js           Werkspresets, Speichern/Teilen
js/ui/controls.js       Drehregler, Fader, Modus-Wahlschalter, Kippschalter, Fußschalter
js/ui/display.js        VFD-Anzeige (Werte, Spektrum, Pegel, Status)
js/audio/engine.js      Audio-Graph, Quellen, Live-Eingang (Kanäle, Abtastrate, Ausgabegerät), Aufnahme, Offline-Render
js/audio/reverb-processor.js   DSP (AudioWorklet)
js/audio/demo.js        Demo-Signale (Karplus-Strong)
js/audio/wav.js         WAV-Encoder (24 Bit)
scripts/serve.mjs       Mini-Webserver ohne Abhängigkeiten
test/                   DSP-Tests (node:test)
```
