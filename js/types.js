// Shared JSDoc types for `// @ts-check`. This module has no runtime exports.

/**
 * @typedef {object} Spike
 * @property {number} x
 * @property {number} y
 * @property {number} radius
 * @property {number} spin turns per second
 *
 * @typedef {object} Water a rectangle of water filling the open air inside it
 * @property {number} x left edge
 * @property {number} y surface height, the top edge
 * @property {number} width
 * @property {number} depth height of the rectangle below the surface
 *
 * @typedef {object} Trail
 * @property {string} name
 * @property {string} [label]
 * @property {object[]} terrainBlocks terrain; see terrain-geometry.js. Blocks with `layer: "back"` are back walls: scenery that keeps caves dark and never collides
 * @property {{ x: number, y?: number | null, facing: 1 | -1 }} start
 * @property {number} goal x coordinate of the finish flower, which may be on either side of the start
 * @property {number | null} [finishY] height the finish stands at; null means on the surface below it
 * @property {number} [fallY]
 * @property {{ x: number, y?: number | null }[]} apples
 * @property {Array<Partial<Spike>>} [spikes]
 * @property {Array<Partial<Water>>} [water]
 * @property {object[]} [props]
 * @property {string} [terrain] material id
 * @property {{ sun?: number, clouds?: number, fog?: number, rain?: number, snow?: number, lightning?: number }} [weather]
 * @property {'hills' | 'mountains' | 'forest' | 'desert' | 'city'} [backdrop] parallax background theme; omitted means hills
 * @property {'morning' | 'noon' | 'evening' | 'night'} [timeOfDay] sky, light and grade preset; omitted keeps the trail's own colours
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
 * @property {object[]} crashedFrameProbes chassis-point blends on the drawn outline
 * @property {object[][]} frameLinks point pairs joined by the suspension and frame
 * @property {boolean} [framePassThrough] crashed frame ignores terrain while straddling a ledge
 * @property {object[]} bikePoints
 *
 * @typedef {object} RideInput
 * @property {number} [facing] 1 or -1; omitted keeps the current facing
 * @property {number} [leanInput] -1 left … 1 right, in screen direction
 * @property {boolean} [accelerating]
 * @property {boolean} [braking]
 *
 * @typedef {{ type: 'start' }
 *   | { type: 'airTurn', full: boolean }
 *   | { type: 'flip', count: number, direction: number }
 *   | { type: 'land', impact: number }
 *   | { type: 'crash', cause: 'spike' | 'head' | 'fall' | 'water', x: number, y: number }
 *   | { type: 'splash', x: number, y: number, speed: number, rider: boolean }
 *   | { type: 'apple', apple: object, collected: number, total: number, split: number }
 *   | { type: 'goalLocked', missing: number }
 *   | { type: 'win', time: number, x: number, y: number }} RideEvent
 *
 * @typedef {object} Ride
 * @property {Trail} trail
 * @property {Wheel} rear
 * @property {Wheel} front
 * @property {Vehicle} vehicle
 * @property {{ x: number, y: number }} flower centre of the finish flower the bike has to touch
 * @property {{ x: number, y: number, taken: boolean }[]} apples
 * @property {Spike[]} spikes
 * @property {Water[]} water
 * @property {'running' | 'crashed' | 'won'} status
 * @property {boolean} started whether the timer has started (on first input)
 * @property {number} time simulated seconds since spawn
 * @property {number} elapsed timer seconds
 * @property {number} collected
 * @property {number} facing
 * @property {number} throttle
 * @property {number} brakePressure
 * @property {number} leanControl
 * @property {number} leanVisual -1 back … 1 forward, relative to facing
 * @property {any} ragdoll
 * @property {number[]} splits timer value at each apple pickup
 * @property {number} seed
 * @property {() => number} random
 * @property {number} steps
 * @property {number} spikeTime
 * @property {'spike' | 'head' | 'fall' | 'water' | null} crashCause
 * @property {number} airRotation
 * @property {number} airTurnMilestone
 * @property {number} previousAirAngle
 * @property {boolean} inJump airborne, or touched down but not yet settled
 * @property {number} landingSteps steps a wheel has been down since the jump
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
