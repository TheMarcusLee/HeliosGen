export function renderPromptTemplate(template: string, variables: Record<string, string>): {
  output: string;
  unresolved: string[];
} {
  const unresolved = new Set<string>();
  const output = template.replace(/@(\w+)/g, (token, name: string) => {
    if (variables[name] !== undefined) return variables[name];
    unresolved.add(name);
    return token;
  });
  return { output, unresolved: [...unresolved] };
}
