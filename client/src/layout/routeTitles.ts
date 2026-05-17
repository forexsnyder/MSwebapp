/** Visible titles for the gradient app header (match tablet mockups). */
export function titleForPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return "Home";
  const map: Record<string, string> = {
    "/request": "Part Request Form",
    "/pick": "Picker Orders",
    "/history": "History",
    "/audit": "Audit",
    "/inventory": "Inventory",
  };
  return map[pathname] ?? "CostPoint Parts";
}
