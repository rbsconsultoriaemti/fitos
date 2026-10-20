import type { Food } from './types';

// A tela de busca (modo "escolher") devolve o alimento escolhido para a tela anterior por aqui.
let picked: Food | null = null;
export const setPickedFood = (food: Food | null) => {
  picked = food;
};
export const consumePickedFood = () => {
  const food = picked;
  picked = null;
  return food;
};
