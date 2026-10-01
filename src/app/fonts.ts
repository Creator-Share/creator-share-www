import localFont from "next/font/local"

export const redditSans = localFont({
  src: "./fonts/RedditSans.ttf",
  weight: "400 800",
  style: "normal",
  variable: "--font-reddit-sans",
  display: "swap",
})
