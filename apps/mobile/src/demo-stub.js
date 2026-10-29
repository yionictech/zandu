// Remplace @zandu/demo dans les versions sans démonstration (metro.config.js) : ni moteur fictif
// ni photos intégrées dans l'application publiée. Rien ici n'est appelé hors EXPO_PUBLIC_DEMO=1.
export const DEMO_ACCOUNTS = {};
export function createDemoState() {
  throw new Error('Démonstration absente de cette version');
}
export class DemoApi {
  constructor() {
    throw new Error('Démonstration absente de cette version');
  }
}
