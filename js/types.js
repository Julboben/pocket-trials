// Shared JSDoc types for `// @ts-check`. This module has no runtime exports.

/**
 * @typedef {[number, number]} Point2
 *
 * @typedef {object} Spike
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} spin turns per second
 *
 * @typedef {object} Level
 * @property {string} name
 * @property {string} [label]
 * @property {Point2[]} points ground polyline
 * @property {{ x: number, y?: number | null, facing: 1 | -1 }} start
 * @property {number} goal x coordinate of the finish gate
 * @property {number} [fallY]
 * @property {{ x: number, y?: number | null }[]} apples
 * @property {Array<Partial<Spike>>} [spikes]
 * @property {Array<{ from: number, to: number }>} [gaps]
 * @property {object[]} [platforms]
 * @property {object[]} [paths]
 * @property {object[]} [props]
 * @property {string} [terrain] material id
 * @property {{ rain?: number, lightning?: number }} [weather]
 * @property {{ gold: number, silver: number, bronze: number }} [medals] target times in seconds
 *
 * @typedef {object} Contact
 * @property {number} nx
 * @property {number} ny
 * @property {number} penetration
 * @property {number} [pointX]
 * @property {number} [pointY]
 * @property {number} [slope]
 * @property {boolean} [swept]
 *
 * @typedef {object} Wheel
 * @property {number} x
 * @property {number} y
 * @property {number} ox previous x (Verlet)
 * @property {number} oy previous y (Verlet)
 * @property {number} [px] x at the start of the latest step, for interpolation
 * @property {number} [py]
 * @property {number} inverseMass
 * @property {boolean} grounded
 * @property {Contact | null} contact
 * @property {string} material
 * @property {number} spin
 * @property {number} angularVelocity
 * @property {number} compression
 * @property {number} impactSpeed
 *
 * @typedef {object} Vehicle
 * @property {Wheel} rear
 * @property {Wheel} front
 * @property {{ rearMount: object, frontMount: object, top: object }} chassis
 * @property {object[]} constraints
 * @property {object[]} dampedConstraints
 * @property {object[]} chassisPoints
 * @property {object[]} bikePoints
 *
 * @typedef {object} RideInput
 * @property {number} [facing] 1 or -1; omitted keeps the current facing
 * @property {number} [leanInput] -1 back … 1 forward
 * @property {boolean} [accelerating]
 * @property {boolean} [braking]
 *
 * @typedef {{ type: 'start' }
 *   | { type: 'airTurn', full: boolean }
 *   | { type: 'flip', count: number, direction: number }
 *   | { type: 'land', impact: number }
 *   | { type: 'crash', cause: 'spike' | 'head' | 'fall', x: number, y: number }
 *   | { type: 'apple', apple: object, collected: number, total: number, split: number }
 *   | { type: 'goalLocked', missing: number }
 *   | { type: 'win', time: number, x: number, y: number }} RideEvent
 *
 * @typedef {object} Ride
 * @property {Level} level
 * @property {Wheel} rear
 * @property {Wheel} front
 * @property {Vehicle} vehicle
 * @property {{ x: number, y: number, taken: boolean }[]} apples
 * @property {Spike[]} spikes
 * @property {'running' | 'crashed' | 'won'} status
 * @property {boolean} started whether the timer has started (on first input)
 * @property {number} time simulated seconds since spawn
 * @property {number} elapsed timer seconds
 * @property {number} collected
 * @property {number} facing
 * @property {number} throttle
 * @property {number} brakePressure
 * @property {number} leanControl
 * @property {number} leanVisual
 * @property {any} ragdoll
 * @property {number[]} splits timer value at each apple pickup
 * @property {number} seed
 * @property {() => number} random
 * @property {number} steps
 * @property {number} spikeTime
 * @property {'spike' | 'head' | 'fall' | null} crashCause
 * @property {number} airRotation
 * @property {number} airTurnMilestone
 * @property {number} previousAirAngle
 * @property {number} lastGateNotice
 * @property {Record<string, { x: number, y: number, radius: number }> | null} previousRiderContacts
 *
 * @typedef {object} LeaderboardRun
 * @property {number} time
 * @property {string} rider
 * @property {number | null} slot
 * @property {number} [saveId]
 * @property {number} [date]
 */

export {};
