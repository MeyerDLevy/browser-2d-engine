export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const SERVICE_HOUR = 10
export const NIGHT_SHIFT_START = 18
export const NIGHT_SHIFT_END = 6
export const MINUTES_PER_REAL_SECOND = 10
export const PERSONALITY_SEED = 20260802

export const TRAITS = [
  'openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism',
  'transcendence', 'honesty_humility',
] as const

export const NEED_KEYS = [
  'hunger', 'energy', 'social', 'fun', 'hygiene', 'comfort', 'meaning', 'aspiration',
] as const

export const TRAIT_SD = 0.5
export const SAVINGS_RATE_DEFAULT = 0.10
export const IMPULSIVITY_K_DEFAULT = 0.15
export const ASPIRATION_MULT_DEFAULT = 1.0
export const UTILITY_GAIN = 4.0
export const URGENCY_EXP = 2.0
export const MULT_MIN = 0.1
export const MULT_MAX = 3.0
export const ASPIRATION_HYSTERESIS = 0.35

export const SNACK_GROCERY = 8.0
export const SNACK_GAS = 10.0
export const UNCOOKED_PRICE = 5.0
export const GROCERY_HAUL = 4
export const COOK_BATCH_UNCOOKED = 3
export const COOK_BATCH_MEALS = 3
export const SNACK_HUNGER_RESTORE = 30.0
export const MEAL_HUNGER_RESTORE = 60.0
export const BAR_DRINK = 10.0
export const WAGES: Record<string, number> = {
  gas_station: 12.0, grocery: 10.0, bar: 11.0, church: 60.0,
  library: 10.0, warehouse: 13.0, town_hall: 15.0,
}
export const RENT_PER_HOUSE = 70.0
export const UTILITY_PER_HOUSE = 20.0
export const ODD_JOB_PAY = 5.0
export const LATE_FEE_PER_DAY = 3.0
export const LOAN_DAYS = 3
export const ORDER_PRICE: Record<string, number> = { snack: 2.0, uncooked: 1.5 }
export const MANAGER_WAGE_MULT = 1.3
export const QUIT_MONEY_THRESHOLD = 15.0
export const QUIT_CHANCE = 0.05
export const TV_PRICE = 400.0
export const TV_LIFETIME_VALUE = 250.0
export const BANK_INTEREST = 0.10
export const BANK_REPAY_PER_DAY = 8.0
export const ASPIRATION_RAID_PENALTY = 25.0
export const MEDICAL_BILL_CHANCE = 0.008
export const MEDICAL_BILL_AMOUNT = 40.0
export const DECAY_ASPIRATION = 0.02
export const LOAN_AMOUNT = 20.0
export const START_TOWN_CASH = 500.0
export const START_BANK_CASH = 300.0
export const START_LEDGERS: Record<string, number> = {
  gas_station: 250, grocery: 350, bar: 150, church: 100,
  library: 150, warehouse: 400, big_box: 200, town_hall: 0,
}

export const TAX_MIN = 0.0
export const TAX_MAX = 0.25
export const TARGET_BUFFER = 500.0
export const SMOOTH_STEP = 0.02
export const OPEN_SLOT_COST = 8.0
export const BUFFER_CATCHUP = 20.0
export const COMFORT_RATE = 0.08
export const STRESS_PASS = 0.35
export const START_SALES_TAX = 0.05

export const OPINION_MIN = -100
export const OPINION_MAX = 100
export const MEMORY_CAP = 5
export const FRIEND_OPINION = 35
export const RIVAL_OPINION = -30
export const FLIRT_MIN_OPINION = 20
export const LOVER_ROMANCE = 40
export const EXCLUSIVE_ROMANCE = 60
export const BREAKUP_OPINION = -20
export const BEDS_PER_HOUSE = 2
export const COHABIT_BASE = 0.85

export const INTERACTIONS: Record<string, { opinion: number; romance: number; social?: number; fun?: number; meaning?: number }> = {
  pleasant_chat: { opinion: 8, romance: 0, social: 10, fun: 4 },
  deep_talk: { opinion: 12, romance: 2, social: 12, fun: 2, meaning: 4 },
  awkward_chat: { opinion: 1, romance: 0, social: 4, fun: -2 },
  insult: { opinion: -14, romance: -4, social: 2, fun: -6 },
  argument: { opinion: -20, romance: -8, social: 2, fun: -8 },
  flirt: { opinion: 6, romance: 18, social: 8, fun: 10 },
  flirt_reject: { opinion: -10, romance: -6, social: 2, fun: -4 },
  jealousy: { opinion: -16, romance: -4, social: 0, fun: -8 },
  breakup: { opinion: -25, romance: -30, social: -4, fun: -10 },
  propose_accept: { opinion: 10, romance: 8, social: 8, fun: 12 },
  propose_reject: { opinion: -8, romance: -5, social: 2, fun: -6 },
}

export const BOOK_GENRES = ['spiritual', 'novel', 'practical'] as const

export const SIGNATURES: Record<string, { minutes: number; needs_filled: Record<string, number>; affinities: Record<string, number> }> = {
  sleep: { minutes: 120, needs_filled: { energy: 84, comfort: 36 }, affinities: {} },
  relax: { minutes: 30, needs_filled: { fun: 18, energy: 3 }, affinities: { conscientiousness: -0.3 } },
  shower: { minutes: 20, needs_filled: { hygiene: 60 }, affinities: { conscientiousness: 0.3 } },
  sit_couch: { minutes: 25, needs_filled: { comfort: 50, fun: 5 }, affinities: { conscientiousness: -0.2 } },
  watch_tv: { minutes: 40, needs_filled: { fun: 30, comfort: 10 }, affinities: { openness: -0.5, conscientiousness: -0.4, transcendence: -0.4 } },
  read_spiritual: { minutes: 30, needs_filled: { fun: 12, meaning: 22 }, affinities: { transcendence: 0.9, openness: 0.6, extraversion: -0.4 } },
  read_novel: { minutes: 30, needs_filled: { fun: 20, meaning: 6 }, affinities: { openness: 0.8, extraversion: -0.5 } },
  read_practical: { minutes: 30, needs_filled: { fun: 10, meaning: 8 }, affinities: { conscientiousness: 0.7, openness: 0.3 } },
  pray_meditate: { minutes: 25, needs_filled: { meaning: 10, comfort: 8 }, affinities: { transcendence: 1.0, neuroticism: 0.2 } },
  attend_service: { minutes: 50, needs_filled: { meaning: 40, social: 20, fun: 8 }, affinities: { transcendence: 1.0, agreeableness: 0.3, openness: 0.2 } },
  go_out: { minutes: 20, needs_filled: { fun: 40, social: 35 }, affinities: { extraversion: 0.9, conscientiousness: -0.4, transcendence: -0.3 } },
  socialize: { minutes: 20, needs_filled: { social: 16, fun: 4 }, affinities: { extraversion: 0.8, agreeableness: 0.4 } },
  eat_meal: { minutes: 15, needs_filled: { hunger: 60 }, affinities: {} },
  shop: { minutes: 15, needs_filled: { hunger: 30 }, affinities: { conscientiousness: -0.3, transcendence: -0.2 } },
  buy_groceries: { minutes: 40, needs_filled: { hunger: 40, comfort: 5 }, affinities: { conscientiousness: 0.4 } },
  cook_meal: { minutes: 30, needs_filled: { hunger: 50 }, affinities: { conscientiousness: 0.4, openness: 0.2 } },
  checkout_spiritual: { minutes: 20, needs_filled: { meaning: 18, fun: 8 }, affinities: { transcendence: 0.9, openness: 0.4 } },
  checkout_novel: { minutes: 20, needs_filled: { meaning: 6, fun: 16 }, affinities: { openness: 0.8 } },
  checkout_practical: { minutes: 20, needs_filled: { meaning: 10, fun: 8 }, affinities: { conscientiousness: 0.7 } },
  buy_tv: { minutes: 30, needs_filled: { fun: 12, comfort: 8 }, affinities: { transcendence: -0.6, openness: -0.2 } },
}

export const ASPIRATIONS: Record<string, {
  horizon: 'mid' | 'long'
  label: string
  trait_affinities: Record<string, number>
  need_pull: Record<string, number>
  boosts: Record<string, number>
  savings_rate_bonus?: number
}> = {
  buy_tv: {
    horizon: 'mid', label: 'Buy a TV',
    trait_affinities: { openness: -0.2, transcendence: -0.6 },
    need_pull: { fun: 0.5, comfort: 0.3 },
    boosts: { buy_tv: 3.0, odd_job: 1.5 },
  },
  build_savings: {
    horizon: 'long', label: 'Build savings',
    trait_affinities: { conscientiousness: 0.8, neuroticism: 0.4 },
    need_pull: { aspiration: 0.4 },
    boosts: { odd_job: 1.8 },
    savings_rate_bonus: 0.10,
  },
  find_relationship: {
    horizon: 'long', label: 'Find a relationship',
    trait_affinities: { extraversion: 0.7, agreeableness: 0.6 },
    need_pull: { social: 1.0 },
    boosts: { socialize: 2.0, go_out: 1.8 },
  },
  have_conversation: {
    horizon: 'mid', label: 'Have a conversation',
    trait_affinities: { extraversion: 0.5, agreeableness: 0.3 },
    need_pull: { social: 1.2 },
    boosts: { socialize: 2.5 },
  },
  read_more: {
    horizon: 'mid', label: 'Read more',
    trait_affinities: { openness: 0.8, conscientiousness: 0.2 },
    need_pull: { meaning: 1.0, fun: 0.3 },
    boosts: {
      checkout_book: 2.0, read: 1.8,
      read_spiritual: 1.5, read_novel: 1.5, read_practical: 1.5,
    },
  },
}

export const DECAY = {
  hunger: 0.08, energy: 0.05, social: 0.04, fun: 0.03,
  hygiene: 0.04, comfort: 0.025, meaning: 0.02,
}
export const SIG_TICK_ACTIONS = ['sleep', 'relax', 'shower', 'sit_couch', 'watch_tv', 'read', 'pray_meditate', 'attend_service', 'socialize']
export const SHOP_RECIPE = ['get_snack', 'pay_snack']
export const RESTOCK_RECIPE = ['get_stock', 'shelve_stock']
export const BUY_GROCERIES_RECIPE = ['get_uncooked', 'pay_uncooked', 'bring_home']
export const COOK_RECIPE = ['get_ingredients', 'cook', 'store_meal']
export const CHECKOUT_RECIPE = ['get_book', 'checkout_desk']
export const DELIVER_RECIPE = ['load_truck', 'unload_truck']
export const NPC_SPEED = 3.2
export const ARRIVE_DIST = 0.55
export const TELEPORT_SPEED = 16

export const HOUSE_SHELF = { uncooked: 12, meal: 8 }
export const BUILDING_KINDS = [
  'house', 'gas_station', 'grocery', 'bar', 'church', 'library', 'warehouse', 'big_box', 'town_hall',
] as const

export type BuildingKind = typeof BUILDING_KINDS[number]

export const BUILDING_SPECS: Record<Exclude<BuildingKind, 'house'>, {
  display: string
  jobs: number
  managers: number
  shelf: Record<string, number>
  backroom: Record<string, number>
  shifts: Record<string, number>
  size: { w: number; h: number }
}> = {
  gas_station: { display: 'Gas Station', jobs: 3, managers: 1, shelf: { snack: 15 }, backroom: { snack: 30 }, shifts: { day: 2, night: 1 }, size: { w: 6, h: 5 } },
  grocery: { display: 'Grocery', jobs: 3, managers: 1, shelf: { snack: 20, uncooked: 20 }, backroom: { snack: 40, uncooked: 60 }, shifts: {}, size: { w: 8, h: 5 } },
  bar: { display: 'The Bar', jobs: 1, managers: 1, shelf: {}, backroom: {}, shifts: {}, size: { w: 6, h: 4 } },
  church: { display: 'Church', jobs: 1, managers: 1, shelf: {}, backroom: {}, shifts: {}, size: { w: 6, h: 5 } },
  library: { display: 'Library', jobs: 1, managers: 1, shelf: { book: 25 }, backroom: {}, shifts: {}, size: { w: 6, h: 5 } },
  warehouse: { display: 'Warehouse', jobs: 4, managers: 0, shelf: { pallet: 6 }, backroom: {}, shifts: {}, size: { w: 8, h: 4 } },
  big_box: { display: 'Big Box', jobs: 0, managers: 0, shelf: { tv: 1 }, backroom: {}, shifts: {}, size: { w: 6, h: 5 } },
  town_hall: { display: 'Town Hall', jobs: 0, managers: 1, shelf: {}, backroom: {}, shifts: {}, size: { w: 5, h: 4 } },
}

export const WAREHOUSE_ROLES = ['truck_driver', 'truck_driver', 'forklift_operator', 'inventory_manager']
export const SIM_BLOCK_RADIUS = 5
export const MAX_HOUSES = 28
export const COMMERCIAL_QUOTA: BuildingKind[] = [
  'town_hall', 'warehouse', 'grocery', 'grocery', 'gas_station', 'gas_station',
  'bar', 'church', 'library', 'big_box',
]

export const FIRST_NAMES = [
  'Alex', 'Blake', 'Casey', 'Drew', 'Eden', 'Frank', 'Gina', 'Hugo', 'Iris', 'Jules',
  'Kai', 'Lane', 'Morgan', 'Nico', 'Oakley', 'Parker', 'Quinn', 'Riley', 'Sage', 'Taylor',
  'Uma', 'Val', 'Wren', 'Xin', 'Yael', 'Zion', 'Avery', 'Blair', 'Cameron', 'Dana',
  'Ellis', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan', 'Kendall', 'Logan', 'Marley', 'Noel',
  'Ocean', 'Peyton', 'Reese', 'Skyler', 'Tatum', 'Unity', 'Vesper', 'Winter', 'Yuri', 'Zephyr',
]

export const NPC_COLORS = [
  '#e07040', '#40a0e0', '#50c070', '#d0c040', '#c060c0', '#40c0c0', '#e080a0', '#90e040',
  '#d08050', '#6090d0', '#70b060', '#c9a040', '#a050a0', '#50b0b0',
]

export const LOG_HEADER = 'day,kind,id,money,savings,aspiration,debt,has_tv,hunger,energy,social,fun,meals,hours_worked,action,town_cash,bank_cash,gas_cash,grocery_cash,bar_cash,church_cash,library_cash,big_box_cash,gas_snack,gas_snack_back,grocery_snack,grocery_uncooked,grocery_snack_back,grocery_uncooked_back,library_books,total_money,sales_tax_rate,taxes_today'
