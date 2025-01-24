import { createListCollection } from "@chakra-ui/react";
export const locations = createListCollection({
  items: [
    { label: "All of Africa", value: "all_africa", group: "Africa" },
    {
      label: "All of East Africa",
      value: "all_east_africa",
      group: "East Africa",
    },
    { label: "Burundi", value: "burundi", group: "East Africa" },
    { label: "Ethiopia", value: "ethiopia", group: "East Africa" },
    { label: "Kenya", value: "kenya", group: "East Africa" },
    { label: "Rwanda", value: "rwanda", group: "East Africa" },
    { label: "Tanzania", value: "tanzania", group: "East Africa" },
    { label: "Uganda", value: "uganda", group: "East Africa" },
    {
      label: "All of Southern Africa",
      value: "all_southern_africa",
      group: "Southern Africa",
    },
    { label: "Congo, DRC", value: "congo_drc", group: "Southern Africa" },
    { label: "Eswatini", value: "eswatini", group: "Southern Africa" },
    { label: "Lesotho", value: "lesotho", group: "Southern Africa" },
    { label: "Malawi", value: "malawi", group: "Southern Africa" },
    { label: "Mozambique", value: "mozambique", group: "Southern Africa" },
    { label: "Zambia", value: "zambia", group: "Southern Africa" },
    { label: "Zimbabwe", value: "zimbabwe", group: "Southern Africa" },
    {
      label: "All of West Africa",
      value: "all_west_africa",
      group: "West Africa",
    },
    { label: "Chad", value: "chad", group: "West Africa" },
    { label: "Ghana", value: "ghana", group: "West Africa" },
    { label: "Mali", value: "mali", group: "West Africa" },
    { label: "Niger", value: "niger", group: "West Africa" },
    { label: "Senegal", value: "senegal", group: "West Africa" },
    { label: "Sierra Leone", value: "sierra_leone", group: "West Africa" },
    {
      label: "All of Latin America/Caribbean",
      value: "all_latin_america",
      group: "Latin America/Caribbean",
    },
    { label: "Bolivia", value: "bolivia", group: "Latin America/Caribbean" },
    { label: "Colombia", value: "colombia", group: "Latin America/Caribbean" },
    {
      label: "Dominican Republic",
      value: "dominican_republic",
      group: "Latin America/Caribbean",
    },
    { label: "Ecuador", value: "ecuador", group: "Latin America/Caribbean" },
    {
      label: "El Salvador",
      value: "el_salvador",
      group: "Latin America/Caribbean",
    },
    {
      label: "Guatemala",
      value: "guatemala",
      group: "Latin America/Caribbean",
    },
    { label: "Haiti", value: "haiti", group: "Latin America/Caribbean" },
    { label: "Honduras", value: "honduras", group: "Latin America/Caribbean" },
    {
      label: "Nicaragua",
      value: "nicaragua",
      group: "Latin America/Caribbean",
    },
    { label: "Peru", value: "peru", group: "Latin America/Caribbean" },
    { label: "All of Asia", value: "all_asia", group: "Asia" },
    { label: "Bangladesh", value: "bangladesh", group: "Asia" },
    { label: "Cambodia (CAM)", value: "cambodia", group: "Asia" },
    { label: "Indonesia", value: "indonesia", group: "Asia" },
    { label: "Philippines", value: "philippines", group: "Asia" },
    { label: "Sri Lanka", value: "sri_lanka", group: "Asia" },
    { label: "Vietnam", value: "vietnam", group: "Asia" },
  ],
});
export const genders = createListCollection({
  items: [
    { label: "Boy", value: "Boy" },
    { label: "Girl", value: "Girl" },
  ],
});

export const ageOptions = createListCollection({
  items: [
    { label: "less than 1", value: "less_than_1" },
    ...Array.from({ length: 14 }, (_, i) => ({
      label: `${i + 1}`,
      value: `${i + 1}`,
    })),
  ],
});

export const monthOptions = createListCollection({
  items: [
    { label: "No Preference", value: "no_preference" },
    { label: "January", value: "january" },
    { label: "February", value: "february" },
    { label: "March", value: "march" },
    { label: "April", value: "april" },
    { label: "May", value: "may" },
    { label: "June", value: "june" },
    { label: "July", value: "july" },
    { label: "August", value: "august" },
    { label: "September", value: "september" },
    { label: "October", value: "october" },
    { label: "November", value: "november" },
    { label: "December", value: "december" },
  ],
});

export const dayOptions = createListCollection({ 
    items:[
    { label: "No Preference", value: "no_preference" },
    ...Array.from({ length: 31 }, (_, i) => ({
      label: `${i + 1}`,
      value: `${i + 1}`,
    })),
  ]
});
