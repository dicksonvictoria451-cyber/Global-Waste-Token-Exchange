;; exchange.clar
;; Global Waste Token Exchange - Core Exchange Contract
;; This contract implements a decentralized order book for trading Waste Quota Tokens (WQT).
;; It supports limit buy/sell orders, order cancellation, and filling orders.
;; Integrates with external contracts: token (SIP-010 WQT), registry, escrow, compliance, oracle.

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-PRICE u102)
(define-constant ERR-ORDER-NOT-FOUND u103)
(define-constant ERR-INSUFFICIENT-BALANCE u104)
(define-constant ERR-PAUSED u105)
(define-constant ERR-INVALID-ORDER-TYPE u106)
(define-constant ERR-ORDER-ALREADY-FILLED u107)
(define-constant ERR-COMPLIANCE-FAIL u108)
(define-constant ERR-ORACLE-FAIL u109)
(define-constant ERR-ESCROW-FAIL u110)
(define-constant ERR-INVALID-RECIPIENT u111)
(define-constant ERR-SELF-TRADE u112)
(define-constant ERR-ORDER-EXPIRED u113)
(define-constant ERR-INVALID-EXPIRY u114)
(define-constant ERR-MAX-ORDERS-REACHED u115)

(define-constant ORDER-TYPE-BUY u1)
(define-constant ORDER-TYPE-SELL u2)

(define-constant MAX-ORDERS-PER-USER u50)
(define-constant MIN-ORDER-AMOUNT u1)
(define-constant MIN-ORDER-PRICE u1)

;; Assume external contracts (deployed separately)
(define-constant TOKEN-CONTRACT .wqt-token)
(define-constant REGISTRY-CONTRACT .registry)
(define-constant ESCROW-CONTRACT .escrow)
(define-constant COMPLIANCE-CONTRACT .compliance) 
(define-constant ORACLE-CONTRACT .oracle)

;; Data Variables
(define-data-var contract-paused bool false)
(define-data-var admin principal tx-sender)
(define-data-var order-counter uint u0)

;; Data Maps
(define-map orders
  { order-id: uint }
  {
    creator: principal,
    order-type: uint, ;; u1 buy, u2 sell
    amount: uint, ;; WQT amount
    price: uint, ;; Price per WQT in micro-STX
    filled: uint, ;; Partially filled amount
    expiry: uint, ;; Block height expiry
    active: bool
  }
)

(define-map user-order-count
  { user: principal }
  uint
)

(define-map user-orders
  { user: principal, index: uint }
  uint ;; order-id
)

;; Private Functions
(define-private (is-registered (user principal))
  (match (contract-call? .registry is-registered user)
    success success
    error false))

(define-private (check-compliance (buyer principal) (seller principal) (amount uint) (price uint))
  (match (contract-call? .compliance check-trade-compliance buyer seller amount price)
    success success
    error false))

(define-private (get-oracle-validation (user principal))
  (match (contract-call? .oracle get-latest-metric user)
    success true
    error false))

(define-private (increment-order-counter)
  (let ((current (var-get order-counter)))
    (var-set order-counter (+ current u1))
    current))

(define-private (add-to-user-orders (user principal) (order-id uint))
  (let ((count (default-to u0 (map-get? user-order-count {user: user}))))
    (if (>= count MAX-ORDERS-PER-USER)
      (err ERR-MAX-ORDERS-REACHED)
      (begin
        (map-set user-orders {user: user, index: count} order-id)
        (map-set user-order-count {user: user} (+ count u1))
        (ok true)))))

;; Public Functions
(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-paused true)
    (ok true)))

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-paused false)
    (ok true)))

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
    (asserts! (not (is-eq new-admin tx-sender)) (err ERR-INVALID-RECIPIENT)) ;; Prevent self-assignment
    (let ((validated-admin new-admin))
      (var-set admin validated-admin)
      (ok true))))

(define-public (create-buy-order (amount uint) (price uint) (expiry uint))
  (let ((order-id (+ (increment-order-counter) u1))
        (validated-amount amount)
        (validated-price price)
        (validated-expiry expiry))
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-registered tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (>= validated-amount MIN-ORDER-AMOUNT) (err ERR-INVALID-AMOUNT))
    (asserts! (>= validated-price MIN-ORDER-PRICE) (err ERR-INVALID-PRICE))
    (asserts! (> validated-expiry block-height) (err ERR-INVALID-EXPIRY))
    (asserts! (get-oracle-validation tx-sender) (err ERR-ORACLE-FAIL))
    (try! (as-contract (contract-call? .escrow lock-stx tx-sender (* validated-amount validated-price) order-id)))
    (map-set orders
      {order-id: order-id}
      {
        creator: tx-sender,
        order-type: ORDER-TYPE-BUY,
        amount: validated-amount,
        price: validated-price,
        filled: u0,
        expiry: validated-expiry,
        active: true
      }
    )
    (try! (add-to-user-orders tx-sender order-id))
    (print {event: "order-created", order-id: order-id, type: "buy", amount: validated-amount, price: validated-price})
    (ok order-id)))

(define-public (create-sell-order (amount uint) (price uint) (expiry uint))
  (let ((order-id (+ (increment-order-counter) u1))
        (validated-amount amount)
        (validated-price price)
        (validated-expiry expiry))
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (is-registered tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (>= validated-amount MIN-ORDER-AMOUNT) (err ERR-INVALID-AMOUNT))
    (asserts! (>= validated-price MIN-ORDER-PRICE) (err ERR-INVALID-PRICE))
    (asserts! (> validated-expiry block-height) (err ERR-INVALID-EXPIRY))
    (asserts! (get-oracle-validation tx-sender) (err ERR-ORACLE-FAIL))
    (try! (as-contract (contract-call? .escrow lock-tokens tx-sender validated-amount order-id .wqt-token)))
    (map-set orders
      {order-id: order-id}
      {
        creator: tx-sender,
        order-type: ORDER-TYPE-SELL,
        amount: validated-amount,
        price: validated-price,
        filled: u0,
        expiry: validated-expiry,
        active: true
      }
    )
    (try! (add-to-user-orders tx-sender order-id))
    (print {event: "order-created", order-id: order-id, type: "sell", amount: validated-amount, price: validated-price})
    (ok order-id)))

(define-public (cancel-order (order-id uint))
  (let ((order (unwrap! (map-get? orders {order-id: order-id}) (err ERR-ORDER-NOT-FOUND)))
        (validated-order-id order-id))
    (asserts! (is-eq tx-sender (get creator order)) (err ERR-UNAUTHORIZED))
    (asserts! (get active order) (err ERR-ORDER-ALREADY-FILLED))
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (map-set orders {order-id: validated-order-id} (merge order {active: false}))
    (try! (as-contract (contract-call? .escrow release validated-order-id (get creator order))))
    (print {event: "order-cancelled", order-id: validated-order-id})
    (ok true)))

(define-public (fill-order (order-id uint) (fill-amount uint))
  (let ((order (unwrap! (map-get? orders {order-id: order-id}) (err ERR-ORDER-NOT-FOUND)))
        (remaining (- (get amount order) (get filled order)))
        (validated-order-id order-id)
        (validated-fill-amount (if (<= fill-amount remaining) fill-amount (err ERR-INVALID-AMOUNT))))
    (asserts! (not (var-get contract-paused)) (err ERR-PAUSED))
    (asserts! (get active order) (err ERR-ORDER-ALREADY-FILLED))
    (asserts! (<= validated-fill-amount remaining) (err ERR-INVALID-AMOUNT))
    (asserts! (not (is-eq tx-sender (get creator order))) (err ERR-SELF-TRADE))
    (asserts! (is-registered tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (< block-height (get expiry order)) (err ERR-ORDER-EXPIRED))
    (asserts! (check-compliance tx-sender (get creator order) validated-fill-amount (get price order)) (err ERR-COMPLIANCE-FAIL))
    (asserts! (get-oracle-validation tx-sender) (err ERR-ORACLE-FAIL))
    (if (is-eq (get order-type order) ORDER-TYPE-BUY)
      (begin
        (try! (contract-call? .wqt-token transfer validated-fill-amount tx-sender (get creator order) none))
        (try! (as-contract (stx-transfer? (* validated-fill-amount (get price order)) tx-sender (get creator order)))))
      (begin
        (try! (stx-transfer? (* validated-fill-amount (get price order)) tx-sender (get creator order)))
        (try! (contract-call? .wqt-token transfer validated-fill-amount (get creator order) tx-sender none))))
    (try! (as-contract (contract-call? .escrow settle validated-order-id tx-sender validated-fill-amount)))
    (let ((new-filled (+ (get filled order) validated-fill-amount)))
      (if (is-eq new-filled (get amount order))
        (map-set orders {order-id: validated-order-id} (merge order {filled: new-filled, active: false}))
        (map-set orders {order-id: validated-order-id} (merge order {filled: new-filled}))))
    (print {event: "order-filled", order-id: validated-order-id, filler: tx-sender, amount: validated-fill-amount})
    (ok true)))

;; Read-Only Functions
(define-read-only (get-order (order-id uint))
  (map-get? orders {order-id: order-id}))

(define-read-only (get-user-order-count (user principal))
  (default-to u0 (map-get? user-order-count {user: user})))

(define-read-only (get-user-order (user principal) (index uint))
  (map-get? user-orders {user: user, index: index}))

(define-read-only (is-contract-paused)
  (var-get contract-paused))

(define-read-only (get-admin)
  (var-get admin))

(define-read-only (get-order-counter)
  (var-get order-counter))