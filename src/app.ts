import {
  buildTitleCards,
  Card,
  createDeck,
  createPlayers,
  createTrainerChallenge,
  drawCards,
  findFirstSet,
  getCardAsset,
  isSet,
  PlayerState,
  shuffle,
  TitleCard,
  TrainerChallenge,
  TrainerMode,
} from "./game";

type Screen = "menu" | "main" | "trainer";
type Tone = "good" | "bad" | "neutral";

interface MainGameState {
  deck: Card[];
  tableSlots: Array<Card | null>;
  players: PlayerState[];
  hand: Card[];
  hintIds: string[];
  message: string;
  tone: Tone;
}

interface TrainerState {
  mode: TrainerMode;
  score: number;
  streak: number;
  bestStreak: number;
  selectedIds: string[];
  message: string;
  tone: Tone;
  challenge: TrainerChallenge;
  locked: boolean;
}

interface AppState {
  screen: Screen;
  playerCount: number;
  titleCards: TitleCard[];
  mainGame: MainGameState | null;
  trainer: TrainerState | null;
}

export class SetApp {
  private readonly root: HTMLElement;

  private readonly sounds = {
    good: new Audio(`${import.meta.env.BASE_URL}legacy/set/sounds/good.wav`),
    bad: new Audio(`${import.meta.env.BASE_URL}legacy/set/sounds/bad.wav`),
  };

  private state: AppState = {
    screen: "menu",
    playerCount: 2,
    titleCards: buildTitleCards(),
    mainGame: null,
    trainer: null,
  };

  private trainerTimeout: number | null = null;
  private pointer = { x: 160, y: 160 };

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener("click", this.handleClick);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("keydown", this.handleKeyDown);
    this.render();
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY };
    this.positionHand();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "Space" || this.state.screen !== "main") {
      return;
    }

    event.preventDefault();
    this.dismissHandCard();
  };

  private readonly handleClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const actionTarget = target?.closest<HTMLElement>("[data-action]");

    if (!actionTarget) {
      return;
    }

    const action = actionTarget.dataset.action;

    switch (action) {
      case "set-players":
        this.state.playerCount = Number(actionTarget.dataset.players ?? "2");
        this.render();
        break;
      case "start-main":
        this.startMainGame();
        break;
      case "start-trainer":
        this.startTrainer((actionTarget.dataset.mode as TrainerMode | undefined) ?? "easy");
        break;
      case "back-menu":
        this.clearTrainerTimeout();
        this.state.screen = "menu";
        this.render();
        break;
      case "restart-main":
        this.startMainGame();
        break;
      case "add-three":
        this.addThreeCards();
        break;
      case "hint":
        this.revealHint();
        break;
      case "claim-player":
        this.claimHandForPlayer(Number(actionTarget.dataset.playerId));
        break;
      case "pick-main-card":
        this.pickMainCard(String(actionTarget.dataset.cardId));
        break;
      case "return-hand":
        this.returnHandToTable();
        break;
      case "toggle-trainer-card":
        this.toggleTrainerSelection(String(actionTarget.dataset.cardId));
        break;
      case "next-trainer":
        this.advanceTrainer();
        break;
      case "restart-trainer":
        this.restartTrainer();
        break;
      default:
        break;
    }
  };

  private render(): void {
    this.root.innerHTML = `
      <div class="shell shell--${this.state.screen}">
        ${this.state.screen === "menu" ? this.renderMenu() : ""}
        ${this.state.screen === "main" ? this.renderMainGame() : ""}
        ${this.state.screen === "trainer" ? this.renderTrainer() : ""}
      </div>
    `;
    this.positionHand();
  }

  private renderMenu(): string {
    const playerButtons = [1, 2, 3, 4].map((count) => {
      const isActive = this.state.playerCount === count;
      return `
        <button
          class="chip ${isActive ? "chip--active" : ""}"
          data-action="set-players"
          data-players="${count}"
        >
          ${count} ${count === 1 ? "player" : "players"}
        </button>
      `;
    });

    const titleCards = this.state.titleCards
      .map(
        (entry, index) => `
          <div
            class="mini-card"
            style="
              --grid-x:${entry.x};
              --grid-y:${entry.y};
              --phase:${entry.phase};
              --drift:${entry.drift}px;
              --delay:${index * 35}ms;
            "
          >
            ${this.renderCard(entry.card, "card-shell--mini")}
          </div>
        `,
      )
      .join("");

    return `
      <main class="intro">
        <section class="hero">
          <div class="hero__backdrop">${titleCards}</div>
          <div class="hero__copy">
            <p class="eyebrow">Kyle Graehl's old pygame card game, rebuilt for the browser.</p>
            <h1>Set</h1>
            <p class="lede">
              Original card art and sounds are carried over from the legacy project.
              Choose a multiplayer table or jump straight into the trainer.
            </p>
            <div class="panel panel--menu">
              <div class="panel__section">
                <span class="label">Main game players</span>
                <div class="chip-row">${playerButtons.join("")}</div>
              </div>
              <div class="action-row">
                <button class="button" data-action="start-main">Start Main Game</button>
                <button
                  class="button button--ghost"
                  data-action="start-trainer"
                  data-mode="easy"
                >
                  Easy Trainer
                </button>
                <button
                  class="button button--ghost"
                  data-action="start-trainer"
                  data-mode="hard"
                >
                  Hard Trainer
                </button>
              </div>
              <div class="panel__footer">
                <span>Modes</span>
                <span>Main game</span>
                <span>Easy trainer</span>
                <span>Hard trainer</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    `;
  }

  private renderMainGame(): string {
    const game = this.state.mainGame;

    if (!game) {
      return "";
    }

    const winnerMessage = this.getWinnerMessage(game.players);
    const tableCards = this.getTableCards(game);
    const gameOver = !findFirstSet(tableCards) && game.deck.length === 0;

    return `
      <main class="workspace">
        <section class="workspace__board">
          <div class="section-head">
            <div>
              <p class="eyebrow">Main game</p>
              <h2>Table</h2>
            </div>
            <div class="deck-panel">
              <div class="deck-stack"></div>
              <div>
                <div class="deck-count">${game.deck.length}</div>
                <div class="deck-label">cards left</div>
              </div>
            </div>
          </div>
          <div class="table-grid">
            ${game.tableSlots
              .map((card) => {
                if (!card) {
                  return `<div class="card-slot" aria-hidden="true"></div>`;
                }

                const classes = [
                  "card-button",
                  game.hintIds.includes(card.id) ? "card-button--hint" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return `
                  <button
                    class="${classes}"
                    data-action="pick-main-card"
                    data-card-id="${card.id}"
                    ${game.hand.length >= 3 ? "disabled" : ""}
                  >
                    ${this.renderCard(card)}
                  </button>
                `;
              })
              .join("")}
          </div>
        </section>
        <aside class="workspace__sidebar">
          <section class="panel">
            <div class="section-head">
              <div>
                <p class="eyebrow">Status</p>
                <h2>${gameOver ? "Game over" : "In play"}</h2>
              </div>
            </div>
            <p class="message message--${game.tone}">
              ${gameOver ? winnerMessage : game.message}
            </p>
            <p class="caption">Cards in hand: ${game.hand.length}/3</p>
            <div class="action-grid">
              <button class="button" data-action="add-three">Add 3 Cards</button>
              <button class="button button--ghost" data-action="hint">Hint</button>
              <button class="button button--ghost" data-action="return-hand">Put Cards Back</button>
              <button class="button button--ghost" data-action="restart-main">New Deal</button>
              <button class="button button--ghost" data-action="back-menu">Main Menu</button>
            </div>
          </section>
          <section class="panel">
            <div class="section-head">
              <div>
                <p class="eyebrow">Scores</p>
                <h2>Claim current hand</h2>
              </div>
            </div>
            <div class="score-list">
              ${game.players
                .map(
                  (player) => `
                    <button
                      class="score-card"
                      data-action="claim-player"
                      data-player-id="${player.id}"
                    >
                      <span>${player.name}</span>
                      <strong>${player.score}</strong>
                    </button>
                  `,
                )
                .join("")}
            </div>
            <p class="caption">
              Pick up to three cards from the table. They will follow the pointer until you
              either score them or put them back.
            </p>
          </section>
        </aside>
        ${this.renderMouseHand(game.hand)}
      </main>
    `;
  }

  private renderTrainer(): string {
    const trainer = this.state.trainer;

    if (!trainer) {
      return "";
    }

    const selectedCount = trainer.selectedIds.length;
    const picksNeeded = trainer.challenge.picksNeeded;
    const selectedCards = this.getSelectedTrainerCards(trainer);
    const chosenClasses = [
      "panel",
      "trainer-selection",
      trainer.locked && trainer.tone === "good" ? "trainer-selection--success" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const chosenCards = [
      ...trainer.challenge.hand.map((card) =>
        this.renderCard(
          card,
          trainer.locked && trainer.tone === "good" ? "card-shell--success" : "",
        ),
      ),
      ...selectedCards.map((card) =>
        this.renderCard(
          card,
          trainer.locked && trainer.tone === "good" ? "card-shell--success" : "",
        ),
      ),
      ...Array.from(
        { length: picksNeeded - selectedCards.length },
        () => `<div class="trainer-slot" aria-hidden="true"></div>`,
      ),
    ].join("");

    return `
      <main class="workspace workspace--trainer">
        <section class="workspace__board">
          <div class="section-head">
            <div>
              <p class="eyebrow">Trainer</p>
              <h2>${trainer.mode === "easy" ? "Easy trainer" : "Hard trainer"}</h2>
            </div>
            <div class="stat-strip">
              <span>${trainer.mode === "easy" ? "Pick 1 card" : "Pick 2 cards"}</span>
              <span>Score ${trainer.score}</span>
              <span>Streak ${trainer.streak}</span>
              <span>Best ${trainer.bestStreak}</span>
            </div>
          </div>
          <section class="${chosenClasses}">
            <p class="label">Chosen set</p>
            <div class="trainer-selection__cards">
              ${chosenCards}
            </div>
            <p class="caption">${trainer.challenge.prompt}</p>
          </section>
          <div class="table-grid table-grid--trainer">
            ${trainer.challenge.options
              .map((card) => {
                const classes = [
                  "card-button",
                  trainer.selectedIds.includes(card.id) ? "card-button--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return `
                  <button
                    class="${classes}"
                    data-action="toggle-trainer-card"
                    data-card-id="${card.id}"
                    ${trainer.locked ? "disabled" : ""}
                  >
                    ${this.renderCard(card)}
                  </button>
                `;
              })
              .join("")}
          </div>
        </section>
        <aside class="workspace__sidebar">
          <section class="panel">
            <div class="section-head">
              <div>
                <p class="eyebrow">Progress</p>
                <h2>${selectedCount}/${picksNeeded} selected</h2>
              </div>
            </div>
            <p class="message message--${trainer.tone}">${trainer.message}</p>
            <div class="action-grid">
              <button class="button" data-action="next-trainer">Skip</button>
              <button class="button button--ghost" data-action="restart-trainer">Reset Session</button>
              <button class="button button--ghost" data-action="back-menu">Main Menu</button>
            </div>
          </section>
        </aside>
      </main>
    `;
  }

  private renderCard(card: Card, extraClass = ""): string {
    const repeatedImages = Array.from({ length: card.count }, () => {
      return `<img src="${getCardAsset(card)}" alt="" draggable="false" />`;
    }).join("");

    return `
      <article class="card-shell ${extraClass}">
        <div class="card-shell__face">
          <div class="card-shell__symbols card-shell__symbols--${card.count}">
            ${repeatedImages}
          </div>
        </div>
      </article>
    `;
  }

  private startMainGame(): void {
    const deck = shuffle(createDeck());
    const initialDeal = drawCards(deck, 12);

    this.state.mainGame = {
      deck: initialDeal.remaining,
      tableSlots: initialDeal.drawn,
      players: createPlayers(this.state.playerCount),
      hand: [],
      hintIds: [],
      message: "Pick up to three cards, then click the player who found the set.",
      tone: "neutral",
    };
    this.state.screen = "main";
    this.render();
  }

  private addThreeCards(): void {
    const game = this.state.mainGame;

    if (!game) {
      return;
    }

    if (game.deck.length === 0) {
      game.message = "The deck is empty.";
      game.tone = "neutral";
      this.render();
      return;
    }

    const nextDraw = drawCards(game.deck, Math.min(3, game.deck.length));
    game.deck = nextDraw.remaining;
    game.tableSlots = this.placeCardsInSlots(game.tableSlots, nextDraw.drawn);
    game.hintIds = [];
    game.message = "Three more cards were added.";
    game.tone = "neutral";
    this.render();
  }

  private revealHint(): void {
    const game = this.state.mainGame;

    if (!game) {
      return;
    }

    const hint = findFirstSet(this.getTableCards(game));

    if (!hint) {
      game.hintIds = [];
      game.message =
        game.deck.length === 0
          ? "No sets remain on the table."
          : "No set is visible. Add three more cards.";
      game.tone = "neutral";
      this.render();
      return;
    }

    game.hintIds = hint.map((card) => card.id);
    game.message = "Hint revealed.";
    game.tone = "neutral";
    this.render();
  }

  private pickMainCard(cardId: string): void {
    const game = this.state.mainGame;

    if (!game) {
      return;
    }

    if (game.hand.length >= 3) {
      game.message = "Your hand is full. Claim it or put cards back first.";
      game.tone = "neutral";
      this.render();
      return;
    }

    const slotIndex = game.tableSlots.findIndex((entry) => entry?.id === cardId);
    const card = slotIndex >= 0 ? game.tableSlots[slotIndex] : null;

    if (!card || slotIndex < 0) {
      return;
    }

    game.tableSlots[slotIndex] = null;
    game.hand = [...game.hand, card];
    game.hintIds = [];
    game.message = game.hand.length === 3
      ? "Hand is full. Click the player who found the set."
      : "Card picked up.";
    this.render();
  }

  private returnHandToTable(): void {
    const game = this.state.mainGame;

    if (!game) {
      return;
    }

    if (game.hand.length === 0) {
      game.message = "No cards are in hand.";
      game.tone = "neutral";
      this.render();
      return;
    }

    game.tableSlots = this.placeCardsInSlots(game.tableSlots, game.hand);
    game.hand = [];
    game.hintIds = [];
    game.message = "Cards returned to the table.";
    game.tone = "neutral";
    this.render();
  }

  private dismissHandCard(): void {
    const game = this.state.mainGame;

    if (!game || game.hand.length === 0) {
      return;
    }

    const card = game.hand[game.hand.length - 1];
    game.hand = game.hand.slice(0, -1);
    game.tableSlots = this.placeCardsInSlots(game.tableSlots, [card]);
    game.hintIds = [];
    game.message = "Returned one card to the table.";
    game.tone = "neutral";
    this.render();
  }

  private claimHandForPlayer(playerId: number): void {
    const game = this.state.mainGame;

    if (!game) {
      return;
    }

    if (game.hand.length !== 3) {
      game.message = "Pick exactly three cards first.";
      game.tone = "neutral";
      this.render();
      return;
    }

    const player = game.players.find((entry) => entry.id === playerId);

    if (!player) {
      return;
    }

    if (isSet(game.hand)) {
      player.score += 1;
      game.hand = [];

      const cardsOnTable = this.getTableCards(game).length;

      if (cardsOnTable < 12 && game.deck.length > 0) {
        const refill = drawCards(game.deck, Math.min(12 - cardsOnTable, game.deck.length));
        game.deck = refill.remaining;
        game.tableSlots = this.placeCardsInSlots(game.tableSlots, refill.drawn);
      }

      game.message = `${player.name} found a set.`;
      game.tone = "good";
      this.playSound("good");
    } else {
      player.score = Math.max(0, player.score - 1);
      game.message = `${player.name} picked a non-set.`;
      game.tone = "bad";
      this.playSound("bad");
    }

    game.hintIds = [];
    this.render();
  }

  private startTrainer(mode: TrainerMode): void {
    this.clearTrainerTimeout();
    this.state.trainer = {
      mode,
      score: 0,
      streak: 0,
      bestStreak: 0,
      selectedIds: [],
      message: "Make your selection from the grid.",
      tone: "neutral",
      challenge: createTrainerChallenge(mode),
      locked: false,
    };
    this.state.screen = "trainer";
    this.render();
  }

  private toggleTrainerSelection(cardId: string): void {
    const trainer = this.state.trainer;

    if (!trainer || trainer.locked) {
      return;
    }

    if (trainer.selectedIds.includes(cardId)) {
      trainer.selectedIds = trainer.selectedIds.filter((id) => id !== cardId);
      this.render();
      return;
    }

    if (trainer.selectedIds.length === trainer.challenge.picksNeeded) {
      trainer.selectedIds = [cardId];
    } else {
      trainer.selectedIds = [...trainer.selectedIds, cardId];
    }

    if (trainer.selectedIds.length === trainer.challenge.picksNeeded) {
      this.evaluateTrainerSelection();
      return;
    }

    this.render();
  }

  private evaluateTrainerSelection(): void {
    const trainer = this.state.trainer;

    if (!trainer) {
      return;
    }

    const expected = [...trainer.challenge.answerIds].sort().join("|");
    const actual = [...trainer.selectedIds].sort().join("|");
    const correct = expected === actual;

    trainer.locked = true;

    if (correct) {
      trainer.score += 1;
      trainer.streak += 1;
      trainer.bestStreak = Math.max(trainer.bestStreak, trainer.streak);
      trainer.message = "Correct.";
      trainer.tone = "good";
      this.playSound("good");
    } else {
      trainer.streak = 0;
      trainer.message = "Not a set. A new prompt is coming.";
      trainer.tone = "bad";
      this.playSound("bad");
    }

    this.render();
    this.clearTrainerTimeout();
    this.trainerTimeout = window.setTimeout(() => {
      this.advanceTrainer();
    }, 900);
  }

  private advanceTrainer(): void {
    const trainer = this.state.trainer;

    if (!trainer) {
      return;
    }

    this.clearTrainerTimeout();
    trainer.challenge = createTrainerChallenge(trainer.mode);
    trainer.selectedIds = [];
    trainer.locked = false;
    trainer.message = "Make your selection from the grid.";
    trainer.tone = "neutral";
    this.render();
  }

  private restartTrainer(): void {
    const trainer = this.state.trainer;
    this.startTrainer(trainer?.mode ?? "easy");
  }

  private clearTrainerTimeout(): void {
    if (this.trainerTimeout !== null) {
      window.clearTimeout(this.trainerTimeout);
      this.trainerTimeout = null;
    }
  }

  private renderMouseHand(hand: Card[]): string {
    if (hand.length === 0) {
      return "";
    }

    return `
      <div class="mouse-hand">
        ${hand
          .map(
            (card, index) => `
              <div
                class="mouse-hand__card"
                style="--hand-offset:${index * 118}px"
              >
                ${this.renderCard(card)}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  private positionHand(): void {
    const hand = this.root.querySelector<HTMLElement>(".mouse-hand");

    if (!hand) {
      return;
    }

    hand.style.setProperty("--pointer-x", `${this.pointer.x}px`);
    hand.style.setProperty("--pointer-y", `${this.pointer.y}px`);
  }

  private getSelectedTrainerCards(trainer: TrainerState): Card[] {
    return trainer.selectedIds
      .map((id) => trainer.challenge.options.find((card) => card.id === id))
      .filter((card): card is Card => Boolean(card));
  }

  private getTableCards(game: MainGameState): Card[] {
    return game.tableSlots.filter((card): card is Card => card !== null);
  }

  private placeCardsInSlots(
    currentSlots: Array<Card | null>,
    cards: Card[],
  ): Array<Card | null> {
    const slots = [...currentSlots];

    for (const card of cards) {
      const emptyIndex = slots.findIndex((entry) => entry === null);
      if (emptyIndex >= 0) {
        slots[emptyIndex] = card;
      } else {
        slots.push(card);
      }
    }

    return slots;
  }

  private playSound(kind: "good" | "bad"): void {
    const sound = this.sounds[kind];
    sound.currentTime = 0;
    void sound.play().catch(() => {
      return undefined;
    });
  }

  private getWinnerMessage(players: PlayerState[]): string {
    const highScore = Math.max(...players.map((player) => player.score));
    const winners = players.filter((player) => player.score === highScore);

    if (winners.length === 1) {
      return `${winners[0].name} wins with ${highScore}.`;
    }

    return `Tie game at ${highScore}.`;
  }
}
