// The robots a driver can pick. Sizes follow a typical REBUILT robot: a 27.5 in square frame
// in bumpers, low enough (under 22.25 in) to drive under the TRENCH.

import type { Text } from '../ui/i18n';

export interface RobotSpec {
  id: string;
  name: string;
  about: Text;
  /** Bumper to bumper, m (square) */
  size: number;
  /** Top of the robot, m: under TRENCH clearance (0.565 m) */
  height: number;
  mass: number;
  /** Swerve module spacing, m */
  track: number;
  maxSpeed: number;
  maxAccel: number;
  maxOmega: number;
  /** FUEL the hopper holds */
  capacity: number;
  /** FUEL shot per second */
  fireRate: number;
  /** Launch speed noise (fraction) and aim noise (degrees) when standing still */
  spread: number;
  aimNoise: number;
  /** How much of its own motion the shooter makes up for when shooting on the move (0..1) */
  lead: number;
  /** Highest TOWER level it can reach, and seconds per level */
  climbMax: 0 | 1 | 2 | 3;
  climbTime: number;
  /** Bumper color accents and the shooter hood */
  look: 'drum' | 'turret' | 'compact';
}

export const ROBOTS: RobotSpec[] = [
  {
    id: 'overload',
    name: 'Overload',
    about: {
      kk: 'Үлкен бункер (50 FUEL), барабанды атқыш, TOWER-дің 3-деңгейіне шығады.',
      ru: 'Большой бункер (50 FUEL), барабанный шутер, лезет на 3-й уровень TOWER.',
      en: 'Big hopper (50 FUEL), drum shooter, climbs to TOWER level 3.',
    },
    size: 0.86, height: 0.55, mass: 62, track: 0.58,
    maxSpeed: 4.5, maxAccel: 9, maxOmega: 9,
    capacity: 50, fireRate: 6, spread: 0.012, aimNoise: 0.6, lead: 0.85,
    climbMax: 3, climbTime: 2.4, look: 'drum',
  },
  {
    id: 'sprinter',
    name: 'Sprinter',
    about: {
      kk: 'Жеңіл әрі жылдам. 25 FUEL, тек 1-деңгейге шығады.',
      ru: 'Лёгкий и быстрый. 25 FUEL, лезет только на 1-й уровень.',
      en: 'Light and fast. 25 FUEL, climbs to level 1 only.',
    },
    size: 0.8, height: 0.5, mass: 48, track: 0.54,
    maxSpeed: 5.4, maxAccel: 12, maxOmega: 11,
    capacity: 25, fireRate: 4.5, spread: 0.018, aimNoise: 0.9, lead: 0.7,
    climbMax: 1, climbTime: 1.6, look: 'compact',
  },
  {
    id: 'turret',
    name: 'Turret',
    about: {
      kk: 'Айналмалы мұнара: жүріп келе жатып дәл атады. 35 FUEL, 2-деңгей.',
      ru: 'Поворотная турель: точно стреляет на ходу. 35 FUEL, 2-й уровень.',
      en: 'A turret: accurate shots on the move. 35 FUEL, level 2.',
    },
    size: 0.84, height: 0.54, mass: 58, track: 0.57,
    maxSpeed: 4.2, maxAccel: 8, maxOmega: 8,
    capacity: 35, fireRate: 4.5, spread: 0.01, aimNoise: 0.5, lead: 1,
    climbMax: 2, climbTime: 2.6, look: 'turret',
  },
];

export const robotById = (id: string): RobotSpec => ROBOTS.find(r => r.id === id) ?? ROBOTS[0];
