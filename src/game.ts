export const COLORS = ["rot", "blau", "gruen"] as const;
export const SHAPES = ["kreis", "welle", "raute"] as const;
export const FILLS = ["ganz", "streifen", "leer"] as const;
export const COUNTS = [1, 2, 3] as const;

export type CardColor = (typeof COLORS)[number];
export type CardShape = (typeof SHAPES)[number];
export type CardFill = (typeof FILLS)[number];
export type CardCount = (typeof COUNTS)[number];

export interface Card {
  id: string;
  color: CardColor;
  shape: CardShape;
  fill: CardFill;
  count: CardCount;
}

export interface PlayerState {
  id: number;
  name: string;
  score: number;
}

export interface TitleCard {
  card: Card;
  x: number;
  y: number;
  phase: number;
  drift: number;
}

export type TrainerChallengeType = "pick-third" | "pick-two";
export type TrainerMode = "easy" | "hard";

export interface TrainerChallenge {
  id: string;
  type: TrainerChallengeType;
  prompt: string;
  hand: Card[];
  options: Card[];
  answerIds: string[];
  picksNeeded: 1 | 2;
}

const titlePattern = `
        0000        111111        2222
      00000000     11    11     222222
    0000          11           22
      000000      111111         2222
          0000    11                 22
    00000000      11           222222
      0000        111111        2222
`.trim();

let trainerSeed = 0;

export function createDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of COLORS) {
    for (const shape of SHAPES) {
      for (const fill of FILLS) {
        for (const count of COUNTS) {
          deck.push({
            id: `${color}-${shape}-${fill}-${count}`,
            color,
            shape,
            fill,
            count,
          });
        }
      }
    }
  }

  return deck;
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

export function isSet(cards: Card[]): boolean {
  if (cards.length !== 3) {
    return false;
  }

  const keys: Array<keyof Pick<Card, "color" | "shape" | "fill" | "count">> = [
    "color",
    "shape",
    "fill",
    "count",
  ];

  return keys.every((key) => {
    const values = new Set(cards.map((card) => card[key]));
    return values.size === 1 || values.size === 3;
  });
}

export function getThirdCard(cardA: Card, cardB: Card): Card {
  return {
    color: thirdValue(COLORS, cardA.color, cardB.color),
    shape: thirdValue(SHAPES, cardA.shape, cardB.shape),
    fill: thirdValue(FILLS, cardA.fill, cardB.fill),
    count: thirdValue(COUNTS, cardA.count, cardB.count),
    id: "",
  } as Card;
}

export function drawCards(
  deck: Card[],
  amount: number,
): { drawn: Card[]; remaining: Card[] } {
  return {
    drawn: deck.slice(0, amount),
    remaining: deck.slice(amount),
  };
}

export function findFirstSet(cards: Card[]): Card[] | null {
  for (let first = 0; first < cards.length - 2; first += 1) {
    for (let second = first + 1; second < cards.length - 1; second += 1) {
      for (let third = second + 1; third < cards.length; third += 1) {
        const candidate = [cards[first], cards[second], cards[third]];
        if (isSet(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

export function getCardAsset(card: Card): string {
  return `/legacy/set/images/${card.shape}_${card.color}_${card.fill}.png`;
}

export function createPlayers(playerCount: number): PlayerState[] {
  return Array.from({ length: playerCount }, (_, index) => ({
    id: index + 1,
    name: `Player ${index + 1}`,
    score: 0,
  }));
}

export function buildTitleCards(): TitleCard[] {
  const lines = titlePattern.split("\n");
  const result: TitleCard[] = [];

  lines.forEach((line, row) => {
    [...line].forEach((char, column) => {
      if (!["0", "1", "2"].includes(char)) {
        return;
      }

      const colorIndex = Number(char);
      const count = COUNTS[(row + column) % COUNTS.length];
      const shape = SHAPES[(row * 2 + column) % SHAPES.length];
      const fill = FILLS[(row + column * 2) % FILLS.length];
      const color = COLORS[colorIndex];

      result.push({
        card: {
          id: `title-${row}-${column}`,
          color,
          shape,
          fill,
          count,
        },
        x: column,
        y: row,
        phase: (row + column) * 0.35,
        drift: 8 + ((row + column) % 5) * 3,
      });
    });
  });

  return result;
}

export function createTrainerChallenge(mode: TrainerMode): TrainerChallenge {
  return mode === "easy" ? buildPickThirdChallenge() : buildPickTwoChallenge();
}

function buildPickThirdChallenge(): TrainerChallenge {
  const deck = shuffle(createDeck());
  const hand = deck.slice(0, 2);
  const answerTemplate = getThirdCard(hand[0], hand[1]);
  const answer = deck.find((card) => card.id === makeCardId(answerTemplate));

  if (!answer) {
    throw new Error("Failed to build pick-third trainer challenge.");
  }

  const options = shuffle(
    [
      answer,
      ...shuffle(
        deck.filter((card) => ![hand[0].id, hand[1].id, answer.id].includes(card.id)),
      ).slice(0, 8),
    ],
  );

  return {
    id: `trainer-${trainerSeed += 1}`,
    type: "pick-third",
    prompt: "Two cards are already in hand. Pick the third card that completes the set.",
    hand,
    options,
    answerIds: [answer.id],
    picksNeeded: 1,
  };
}

function buildPickTwoChallenge(): TrainerChallenge {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const deck = shuffle(createDeck());
    const anchor = deck[0];
    const partner = deck[1];
    const answerTemplate = getThirdCard(anchor, partner);
    const match = deck.find((card) => card.id === makeCardId(answerTemplate));

    if (!match || match.id === anchor.id || match.id === partner.id) {
      continue;
    }

    const options = shuffle(
      [
        partner,
        match,
        ...shuffle(
          deck.filter(
            (card) => ![anchor.id, partner.id, match.id].includes(card.id),
          ),
        ).slice(0, 10),
      ],
    );

    const matchingPairs = countPairsForAnchor(anchor, options);
    const targetIds = new Set([partner.id, match.id]);

    if (
      matchingPairs.length === 1 &&
      matchingPairs[0].every((card) => targetIds.has(card.id))
    ) {
      return {
        id: `trainer-${trainerSeed += 1}`,
        type: "pick-two",
        prompt:
          "One card is already in hand. Pick the two cards from the grid that complete the set.",
        hand: [anchor],
        options,
        answerIds: [partner.id, match.id],
        picksNeeded: 2,
      };
    }
  }

  return buildPickThirdChallenge();
}

function countPairsForAnchor(anchor: Card, options: Card[]): Card[][] {
  const matches: Card[][] = [];

  for (let first = 0; first < options.length - 1; first += 1) {
    for (let second = first + 1; second < options.length; second += 1) {
      const setCandidate = [anchor, options[first], options[second]];
      if (isSet(setCandidate)) {
        matches.push([options[first], options[second]]);
      }
    }
  }

  return matches;
}

function thirdValue<T>(values: readonly T[], first: T, second: T): T {
  if (first === second) {
    return first;
  }

  return values.find((value) => value !== first && value !== second) as T;
}

function makeCardId(card: Omit<Card, "id">): string {
  return `${card.color}-${card.shape}-${card.fill}-${card.count}`;
}
