# Graph Report - C:/Users/Floxa/Downloads/mots-1.0  (2026-06-07)

## Corpus Check
- 39 files · ~111,770 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 171 nodes · 271 edges · 18 communities (16 shown, 2 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Cell Types (case.js)|Cell Types (case.js)]]
- [[_COMMUNITY_Client Engine (mflEngine)|Client Engine (mflEngine)]]
- [[_COMMUNITY_Configuration|Configuration]]
- [[_COMMUNITY_Grid Manager|Grid Manager]]
- [[_COMMUNITY_Game UI (In-Play Screenshot)|Game UI (In-Play Screenshot)]]
- [[_COMMUNITY_RequireJS Library|RequireJS Library]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_Typography & Icons|Typography & Icons]]
- [[_COMMUNITY_Cursor & Input|Cursor & Input]]
- [[_COMMUNITY_Monster Avatars|Monster Avatars]]
- [[_COMMUNITY_Grid Display (grid.js)|Grid Display (grid.js)]]
- [[_COMMUNITY_Login Screen UI|Login Screen UI]]
- [[_COMMUNITY_Background Images|Background Images]]
- [[_COMMUNITY_Claude Settings|Claude Settings]]
- [[_COMMUNITY_Chat System|Chat System]]

## God Nodes (most connected - your core abstractions)
1. `gridManager.js` - 20 edges
2. `mflEngine.js` - 16 edges
3. `motsFleches.js` - 12 edges
4. `require.min.js` - 12 edges
5. `ha()` - 11 edges
6. `cursor.js` - 10 edges
7. `GRID_PROVIDER` - 8 edges
8. `v()` - 8 edges
9. `Monster 1 Avatar (Teal Cat)` - 8 edges
10. `Monster 2 Avatar (Pink Tentacle Monster)` - 8 edges

## Surprising Connections (you probably didn't know these)
- `conf` --imports_from--> `game_files_gridmanager`  [EXTRACTED]
   → 
- `conf` --imports_from--> `game_files_motsfleches`  [EXTRACTED]
   → 
- `conf_grid_provider` --imports--> `game_files_gridmanager`  [EXTRACTED]
   → 
- `game_files_case` --imports_from--> `game_files_gridmanager`  [EXTRACTED]
   → 
- `game_files_enums` --imports_from--> `game_files_gridmanager`  [EXTRACTED]
   → 
- `game_files_gridmanager` --imports_from--> `game_files_motsfleches`  [EXTRACTED]
   → 
- `game_files_gridmanager` --imports_from--> `server`  [EXTRACTED]
   → 
- `game_files_motsfleches` --imports_from--> `server`  [EXTRACTED]
   → 

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **ABeeZee Font Variants (Regular + Italic)** — font_abeezee_regular, font_abeezee_italic, font_abeezee_family [EXTRACTED 1.00]
- **Game UI Typography Assets** — font_abeezee_regular, font_abeezee_italic, font_icomoon, readme_game_concept [INFERRED 0.85]
- **Player Avatar Set** — logos_monster1_avatar, logos_monster2_avatar, logos_monster3_avatar, logos_monster4_avatar, logos_monster5_avatar, logos_monster6_avatar, logos_monster7_avatar, logos_monster8_avatar, logos_monster9_avatar [EXTRACTED 1.00]
- **UI Background Texture Set** — images_green_bg_background, images_grey_bg_background, images_grey_background, images_pink_bg_background [EXTRACTED 1.00]

## Communities (18 total, 2 thin omitted)

### Community 0 - "Cell Types (case.js)"
Cohesion: 0.14
Nodes (5): bindChatHandler(), bindWordHandler(), broadcastRoomList(), getRoomList(), registerPlayerInRoom()

### Community 1 - "Client Engine (mflEngine)"
Cohesion: 0.24
Nodes (13): clearPendingRoomHandlers(), enterLoginPhase(), getRoomCodeFromURL(), joinRoom(), prepareUserLoginForm(), sendPlayerReady(), setPlayerColor(), setupGameListeners() (+5 more)

### Community 2 - "Configuration"
Cohesion: 0.14
Nodes (12): GRID_PROVIDER, PROVIDER_ADDR, PROVIDER_DEFAULT_GRID, PROVIDER_DEFAULT_GRID_DATE, PROVIDER_EXTENSION, PROVIDER_FIRST_GRID, PROVIDER_NAME, SERVER_PORT (+4 more)

### Community 3 - "Grid Manager"
Cohesion: 0.24
Nodes (11): evictCacheIfNeeded(), failWaiters(), getCaseType(), getNextCase(), insertDescription(), loadFromText(), loadOne(), onGetGridError() (+3 more)

### Community 4 - "Game UI (In-Play Screenshot)"
Cohesion: 0.22
Nodes (13): Chat Panel (Left Sidebar), Color-Coded Words by Player, Countdown Timer, Crossword Grid, Description Cases (Black Cells with Clues), Grid Info Banner, Letter Cases (White Input Cells), Multiplayer In-Progress State (+5 more)

### Community 5 - "RequireJS Library"
Cohesion: 0.41
Nodes (11): B(), C(), ea(), G(), H(), ha(), j(), s() (+3 more)

### Community 6 - "Package Dependencies"
Cohesion: 0.15
Nodes (12): dependencies, express, prompts, pug, socket.io, engines, node, name (+4 more)

### Community 7 - "Typography & Icons"
Cohesion: 0.21
Nodes (12): ABeeZee Font Family, ABeeZee Italic Webfont (SVG), ABeeZee Regular Webfont (SVG), IcoMoon Icon Font (SVG), IcoMoon Icon Set, Bonus Points System, Buatoom (Monster Illustrations Artist), In-game Chat Commands (+4 more)

### Community 8 - "Cursor & Input"
Cohesion: 0.38
Nodes (9): activateCell(), ensureMobileInput(), focusMobileInput(), insertLetter(), moveCursor(), onClickReceived(), onLetterPressed(), removeLetter() (+1 more)

### Community 9 - "Monster Avatars"
Cohesion: 1.00
Nodes (9): Monster 1 Avatar (Teal Cat), Monster 2 Avatar (Pink Tentacle Monster), Monster 3 Avatar (Yellow Octopus), Monster 4 Avatar (Brown Blob Monster), Monster 5 Avatar (Green Horned Monster), Monster 6 Avatar (Red Round Monster), Monster 7 Avatar (Dark Grey Fuzzy Creature), Monster 8 Avatar (Purple Round Monster) (+1 more)

### Community 10 - "Grid Display (grid.js)"
Cohesion: 0.32
Nodes (3): findWord(), getFrameAxisNumber(), onNewLetterPrinted()

### Community 11 - "Login Screen UI"
Cohesion: 0.39
Nodes (8): Game Title (MOTS.JS), Jouer Button (Join Game), Login Screen / Lobby Panel, Monster Avatar Options (9 monsters), Monster Selector Row, Pseudo Input Field (Votre pseudo), Scrabble-Style Title Tiles, Teal/Turquoise Background Design

### Community 13 - "Background Images"
Cohesion: 0.83
Nodes (4): Green Background (green-bg.png), Grey Polygon Background (grey.png), Grey-White Background (grey-bg.png), Pink Background (pink-bg.png)

## Knowledge Gaps
- **27 isolated node(s):** `allow`, `SERVER_PORT`, `SOCKET_ADDR`, `SOCKET_PORT`, `PROVIDER_NAME` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.