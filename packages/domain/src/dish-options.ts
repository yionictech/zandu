import { DomainError } from './errors.js';

/**
 * Options d'un plat (restaurants) : jusqu'à 3 choix obligatoires, chacun parmi 2 à 8
 * propositions avec leur supplément (« Taille : Normal / Grand +1 000 »). Le client choisit
 * une proposition par groupe ; le prix unitaire de la ligne comprend les suppléments.
 */
export interface DishChoice {
  label: string;
  extra: number;
}
export interface DishOptionGroup {
  name: string;
  choices: DishChoice[];
}
export interface ChosenOption {
  group: string;
  choice: string;
  extra: number;
}

export const MAX_OPTION_GROUPS = 3;
export const MAX_CHOICES = 8;
export const MAX_EXTRA = 100_000;

const clean = (text: string) => text.trim().replace(/\s+/g, ' ');

/** Vérifie et nettoie les options saisies par le restaurant. */
export function normalizeDishOptions(groups: DishOptionGroup[]): DishOptionGroup[] {
  if (groups.length > MAX_OPTION_GROUPS)
    throw new DomainError('invalid_options', `${MAX_OPTION_GROUPS} choix au plus par plat`);
  const names = new Set<string>();
  return groups.map((g) => {
    const name = clean(g.name);
    if (name.length < 2 || name.length > 40)
      throw new DomainError('invalid_options', 'Nom de choix de 2 à 40 caractères');
    if (names.has(name.toLowerCase()))
      throw new DomainError('invalid_options', `Choix en double : ${name}`);
    names.add(name.toLowerCase());
    if (g.choices.length < 2 || g.choices.length > MAX_CHOICES)
      throw new DomainError('invalid_options', `« ${name} » : de 2 à ${MAX_CHOICES} propositions`);
    const labels = new Set<string>();
    const choices = g.choices.map((c) => {
      const label = clean(c.label);
      if (label.length < 1 || label.length > 40)
        throw new DomainError('invalid_options', `« ${name} » : proposition vide ou trop longue`);
      if (labels.has(label.toLowerCase()))
        throw new DomainError('invalid_options', `« ${name} » : « ${label} » en double`);
      labels.add(label.toLowerCase());
      if (!Number.isSafeInteger(c.extra) || c.extra < 0 || c.extra > MAX_EXTRA)
        throw new DomainError('invalid_options', `« ${label} » : supplément invalide`);
      return { label, extra: c.extra };
    });
    return { name, choices };
  });
}

/**
 * Choix du client (une proposition par groupe, dans l'ordre des groupes) : supplément total et
 * instantané à garder dans la commande. Sans options, aucun choix n'est accepté.
 */
export function resolveDishOptions(
  groups: DishOptionGroup[] | null,
  chosen: string[] | undefined,
): { extra: number; options: ChosenOption[] } {
  const list = groups ?? [];
  const picks = chosen ?? [];
  if (picks.length !== list.length)
    throw new DomainError(
      'options_required',
      list.length
        ? `Choisissez : ${list.map((g) => g.name).join(', ')}`
        : 'Ce produit n’a pas d’options',
    );
  const options = list.map((g, i) => {
    const choice = g.choices.find((c) => c.label === picks[i]);
    if (!choice)
      throw new DomainError(
        'invalid_option_choice',
        `« ${picks[i]} » n'est pas proposé pour ${g.name}`,
      );
    return { group: g.name, choice: choice.label, extra: choice.extra };
  });
  return { extra: options.reduce((n, o) => n + o.extra, 0), options };
}

/** « Poulet DG (Grand, Alloco) » : titre de ligne avec les choix. */
export function titleWithOptions(title: string, options: ChosenOption[]): string {
  return options.length ? `${title} (${options.map((o) => o.choice).join(', ')})` : title;
}
