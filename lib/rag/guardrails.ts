export function isQuestionUsable(input: string) {
  return input.trim().length >= 3;
}

export function buildFallbackResponse() {
  return 'Ne mogu pouzdano odgovoriti na temelju dostupnih javnih izvora. Molim provjerite službenu mrežnu stranicu veleučilišta ili kontaktirajte studentsku službu.';
}

export function containsCitation(text: string) {
  return /\[Izvor:.*?\]/i.test(text);
}
