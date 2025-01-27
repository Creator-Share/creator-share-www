export const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
  
    const day = date.getDate();
    const suffix =
      day % 10 === 1 && day !== 11
        ? "st"
        : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
        ? "rd"
        : "th";
  
    const options: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
    };
  
    const formattedDate = new Intl.DateTimeFormat("en-US", options).format(date);

    return formattedDate.replace(/\d+/, `${day}${suffix}`);
  };
  