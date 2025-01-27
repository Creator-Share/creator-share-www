
export const calculateAge = (birthDate: string): number => {
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();

    const isBirthdayPassedThisYear =
      today.getMonth() > birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  
    if (!isBirthdayPassedThisYear) {
      age -= 1;
    }
    return age;
  };
  