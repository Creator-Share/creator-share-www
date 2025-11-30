import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
})

interface SendEmailParams {
  to: string
  subject: string
  text?: string
  html?: string
}

export const sendEmail = async ({
  to,
  subject,
  text,
  html,
}: SendEmailParams) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error("Email configuration is missing")
    return { success: false, error: "Email service not configured" }
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"Creator Share" <noreply@yourapp.com>',
      to,
      subject,
      text,
      html,
    })

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error("Error sending email - full details:", error)
    return { success: false, error }
  }
}

export const sendPartnershipConfirmationEmail = async (
  email: string,
  project: string,
  amount: number,
  interval: string,
  partnerName?: string | null,
) => {
  const subject = `Thank you for partnering with Creator Share Foundation!`

  const formattedAmount = (amount / 100).toFixed(2)
  const intervalText = interval === "month" ? "monthly" : "yearly"
  const greeting = partnerName ? `Dear ${partnerName},` : "Dear Partner,"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Thank You for Your Partnership!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Thank you for your generous contribution of <strong style="color: #1C3C8C;">$${formattedAmount}</strong> ${intervalText} to support our ${project} project.</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Your partnership makes a significant difference in helping us provide safety, healing, and a future full of promise for some of the most vulnerable children in the world.</p>
      </div>
      
      <div style="border-left: 4px solid #1C3C8C; padding-left: 1rem; margin-bottom: 1.5rem;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.75rem;">We'll keep you updated on how your partnership is making an impact and share stories of the lives being changed through your support.</p>
        <p style="font-size: 1rem; line-height: 1.5;">If you have any questions about your partnership, please don't hesitate to contact us.</p>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Warm regards,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: email,
    subject,
    html,
  })
}

export const sendSponsorshipConfirmationEmail = async (
  email: string,
  childName: string,
  amount: number,
  interval: string,
  sponsorName?: string | null,
) => {
  const subject = `Thank you for sponsoring ${childName}!`

  const formattedAmount = (amount / 100).toFixed(2)
  const intervalText = interval === "month" ? "monthly" : "yearly"
  const stripePortalUrl = "https://stripe.creatorshare.com"
  const greeting = sponsorName ? `Dear ${sponsorName},` : "Dear Sponsor,"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Thank You for Your Sponsorship!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Thank you for your generous contribution of <strong style="color: #1C3C8C;">$${formattedAmount}</strong> ${intervalText} to sponsor ${childName}.</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Your support makes a significant difference in providing education and opportunities for children in need.</p>
      </div>
      
      <div style="border-left: 4px solid #1C3C8C; padding-left: 1rem; margin-bottom: 1.5rem;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.75rem;">We'll keep you updated on ${childName}'s progress and how your sponsorship is making an impact.</p>
        <p style="font-size: 1rem; line-height: 1.5;">If you have any questions about your sponsorship, please don't hesitate to contact us.</p>
      </div>
      
      <div style="background-color: #eff6ff; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; text-align: center;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Manage your subscription, update payment methods, or view billing history:</p>
        <a href="${stripePortalUrl}" style="display: inline-block; background-color: #1C3C8C; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 0.375rem; font-weight: 500;">Manage Subscription</a>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Warm regards,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: email,
    subject,
    html,
  })
}

export const sendPaymentFailedEmail = async (
  email: string,
  childName: string,
  amount: number,
  nextAttemptDate: Date | null,
  sponsorName?: string | null,
) => {
  const subject = `Action Required: Your Sponsorship Payment for ${childName} Failed`

  const formattedAmount = amount.toFixed(2)
  const nextAttemptText = nextAttemptDate
    ? `We'll automatically try again on ${nextAttemptDate.toLocaleDateString()}.`
    : "We'll automatically try again soon."
  const greeting = sponsorName ? `Dear ${sponsorName},` : "Dear Sponsor,"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #fef2f2; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid #dc2626;">
        <h2 style="color: #dc2626; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Payment Failed</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">We were unable to process your sponsorship payment of <strong>$${formattedAmount}</strong>.</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${nextAttemptText}</p>
      </div>
      
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h3 style="font-size: 1.25rem; font-weight: 600; margin-top: 0;">What You Can Do:</h3>
        <ul style="font-size: 1rem; line-height: 1.5;">
          <li style="margin-bottom: 0.5rem;">Check that your payment method has sufficient funds</li>
          <li style="margin-bottom: 0.5rem;">Verify that your card hasn't expired</li>
          <li style="margin-bottom: 0.5rem;">Update your payment information in your account</li>
        </ul>
        <div style="text-align: center; margin-top: 1.5rem;">
          <a href="https://your-domain.com/account/billing" style="display: inline-block; background-color: #1C3C8C; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 0.375rem; font-weight: 500;">Update Payment Method</a>
        </div>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Thank you for your continued support,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: email,
    subject,
    html,
  })
}

export const sendSubscriptionConfirmationEmail = async (
  email: string,
  beneficiaryName: string,
  subscriberName?: string | null,
) => {
  const subject = `You're subscribed to updates for ${beneficiaryName}!`
  const greeting = subscriberName ? `Dear ${subscriberName},` : "Dear Subscriber,"
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Subscription Confirmed!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Thank you for subscribing to updates for <strong>${beneficiaryName}</strong>.</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">You'll receive an email whenever there's a new activity or update for this beneficiary.</p>
        <p style="font-size: 1rem; line-height: 1.5;">You can unsubscribe at any time by contacting us.</p>
      </div>
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Thank you for staying connected,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `
  return sendEmail({
    to: email,
    subject,
    html,
  })
}

/**
 * Send activity notification email to a subscriber
 */
export const sendActivityNotificationEmail = async (
  email: string,
  beneficiary: { name: string },
  activity: { title: string; description: string; imageUrls?: string[] },
  subscriberName?: string | null,
) => {
  const subject = `New update on ${beneficiary.name}`
  const greeting = subscriberName ? `Dear ${subscriberName},` : "Dear Subscriber,"
  
  // Generate image HTML if images are provided
  let imagesHtml = ""
  if (activity.imageUrls && activity.imageUrls.length > 0) {
    // Use table layout for better email client compatibility
    const imagesPerRow = 2
    const imageRows: string[][] = []
    for (let i = 0; i < activity.imageUrls.length; i += imagesPerRow) {
      imageRows.push(activity.imageUrls.slice(i, i + imagesPerRow))
    }
    
    imagesHtml = `
      <div style="margin: 1.5rem 0;">
        <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 1rem; color: #1C3C8C;">Photos:</h3>
        <table style="width: 100%; border-collapse: collapse;">
          ${imageRows.map((row) => `
            <tr>
              ${row.map((imageUrl) => `
                <td style="padding: 0.5rem; width: 50%;">
                  <div style="border-radius: 0.5rem; overflow: hidden; border: 1px solid #e5e7eb; background-color: #f9fafb;">
                    <img 
                      src="${imageUrl}" 
                      alt="Activity photo" 
                      style="width: 100%; max-width: 100%; height: auto; display: block; border: none;"
                    />
                  </div>
                </td>
              `).join("")}
              ${row.length < imagesPerRow ? `<td style="width: 50%;"></td>` : ""}
            </tr>
          `).join("")}
        </table>
      </div>
    `
  }
  
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">New Update for ${
          beneficiary.name
        }</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">A new activity has been posted for <strong>${
          beneficiary.name
        }</strong>:</p>
        <p style="font-size: 1.1rem; font-weight: 600; color: #1C3C8C; margin-bottom: 0.5rem;">${
          activity.title
        }</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${
          activity.description
        }</p>
        ${imagesHtml}
        <p style="font-size: 1rem; line-height: 1.5; margin-top: 1.5rem;">Visit the site for more details and to see all updates.</p>
      </div>
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Thank you for staying connected,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `
  return sendEmail({
    to: email,
    subject,
    html,
  })
}

/**
 * Send "budget goal fulfilled" email to a subscriber
 */
export const sendGoalFulfilledEmail = async (
  email: string,
  beneficiary: { name: string; budget_goal: number },
  subscriberName?: string | null,
) => {
  const subject = `Goal Fulfilled for ${beneficiary.name}!`
  const formattedGoal = beneficiary.budget_goal
    ? `$${(beneficiary.budget_goal / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
      })}`
    : "the goal amount"
  const greeting = subscriberName ? `Dear ${subscriberName},` : "Dear Subscriber,"
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      <div style="background-color: #f0fdf4; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #16a34a; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Goal Fulfilled!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">
          We are excited to let you know that <strong>${
            beneficiary.name
          }</strong> has reached their budget goal of <strong>${formattedGoal}</strong>!
        </p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">
          Thank you for your support and for being part of this journey.
        </p>
        <p style="font-size: 1rem; line-height: 1.5;">
          Stay tuned for more updates and stories of impact.
        </p>
      </div>
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">With gratitude,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `
  return sendEmail({
    to: email,
    subject,
    html,
  })
}

/**
 * Send budget fulfilled rejection notification email
 * This is sent when someone attempts to sponsor a beneficiary whose budget goal has already been met
 */
export const sendBudgetFulfilledRejectionEmail = async (
  email: string,
  beneficiaryName: string,
  amount: number,
  sponsorName?: string | null,
) => {
  const subject = `Thank You - ${beneficiaryName} Has Been Fully Sponsored!`
  const formattedAmount = (amount / 100).toFixed(2)
  const greeting = sponsorName ? `Dear ${sponsorName},` : "Dear Friend,"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #f0fdf4; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid #10b981;">
        <h2 style="color: #10b981; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Good News - ${beneficiaryName} is Fully Sponsored!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">
          Thank you for your generous heart in wanting to sponsor <strong>${beneficiaryName}</strong>.
        </p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">
          We're delighted to share that <strong>${beneficiaryName} has already been fully sponsored</strong> by other generous supporters and has met their budget goal! This is wonderful news for ${beneficiaryName}.
        </p>
      </div>
      
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h3 style="font-size: 1.25rem; font-weight: 600; margin-top: 0; color: #1C3C8C;">What This Means for Your Payment</h3>
        <ul style="font-size: 1rem; line-height: 1.5; margin-bottom: 0;">
          <li style="margin-bottom: 0.75rem;">Your subscription has been cancelled</li>
          <li style="margin-bottom: 0.75rem;">Your payment of <strong>$${formattedAmount}</strong> will not be processed</li>
          <li style="margin-bottom: 0.75rem;">If a charge appeared on your card, it will be refunded within 5-10 business days</li>
        </ul>
      </div>
      
      <div style="background-color: #eff6ff; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h3 style="font-size: 1.25rem; font-weight: 600; margin-top: 0; color: #1C3C8C;">Sponsor Another Child in Need</h3>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">
          While ${beneficiaryName}'s sponsorship needs have been met, there are many other wonderful children still waiting for a sponsor like you. Each child has their own unique story and dreams for the future.
        </p>
        <div style="text-align: center; margin-top: 1.5rem;">
          <a href="https://creatorshare.com" style="display: inline-block; background-color: #1C3C8C; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 0.375rem; font-weight: 500;">Explore Children Needing Support</a>
        </div>
      </div>
      
      <div style="border-left: 4px solid #10b981; padding-left: 1rem; margin-bottom: 1.5rem;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.75rem;">
          Your willingness to make a difference is truly appreciated. We would be honored if you would consider extending your generosity to another child who still needs support.
        </p>
        <p style="font-size: 1rem; line-height: 1.5;">
          If you have any questions or concerns, please don't hesitate to contact us.
        </p>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">With gratitude for your generous spirit,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: email,
    subject,
    html,
  })
}

/**
 * Send monthly payment confirmation email when a subscription payment clears
 * This is separate from activity notifications and not unsubscribable
 */
export const sendManagerSponsorshipNotificationEmail = async (
  childName: string,
  amount: number,
  interval: string,
  customerEmail?: string | null,
  customerName?: string | null,
) => {
  const subject = `New Sponsorship Received for ${childName}`
  const formattedAmount = (amount / 100).toFixed(2)
  const intervalText = interval === "month" ? "monthly" : "yearly"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #f0fdf4; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #16a34a; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">New Sponsorship Received!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">A new sponsorship has been received with the following details:</p>
        
        <div style="background-color: white; padding: 1rem; border-radius: 0.375rem; margin: 1rem 0;">
          <p style="margin: 0.5rem 0;"><strong>Child:</strong> ${childName}</p>
          <p style="margin: 0.5rem 0;"><strong>Amount:</strong> $${formattedAmount}/${intervalText}</p>
          <p style="margin: 0.5rem 0;"><strong>Sponsor Name:</strong> ${customerName || 'Not provided'}</p>
          <p style="margin: 0.5rem 0;"><strong>Sponsor Email:</strong> ${customerEmail || 'Not provided'}</p>
        </div>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: "johnstjulien@sharetanzania.com",
    subject,
    html,
  })
}

export const sendMonthlyPaymentConfirmationEmail = async (
  email: string,
  childName: string,
  amount: number,
  sponsorName?: string | null,
) => {
  const subject = `Payment Confirmation: Your Sponsorship for ${childName}`
  const formattedAmount = (amount / 100).toFixed(2)
  const stripePortalUrl = "https://stripe.creatorshare.com"
  const greeting = sponsorName ? `Dear ${sponsorName},` : "Dear Sponsor,"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #f0fdf4; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #16a34a; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Payment Confirmed</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${greeting}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Your monthly sponsorship payment of <strong style="color: #1C3C8C;">$${formattedAmount}</strong> for <strong>${childName}</strong> has been successfully processed.</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Thank you for your continued support in making a difference in ${childName}'s life.</p>
      </div>
      
      <div style="background-color: #eff6ff; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; text-align: center;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1.25rem;">
          <b>To update or cancel your sponsorship, access your billing portal here:</b>
        </p>
        <a href="${stripePortalUrl}" style="display: inline-block; background-color: #1C3C8C; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 0.375rem; font-weight: 500; font-size: 1.1rem;">Manage or Cancel Subscription</a>
        <p style="font-size: 0.95rem; color: #475569; margin: 1.25rem 0 0 0;">
          The link above lets you securely update payment methods, download receipts, or cancel your sponsorship at any time.
        </p>
      </div>
      
      <div style="border-left: 4px solid #1C3C8C; padding-left: 1rem; margin-bottom: 1.5rem;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.75rem;">We'll continue to keep you updated on ${childName}'s progress and how your sponsorship is making an impact.</p>
        <p style="font-size: 1rem; line-height: 1.5;">If you have any questions about your sponsorship, please don't hesitate to contact us.</p>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">With gratitude,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: email,
    subject,
    html,
  })
}

/**
 * Send sponsorship cancellation notification email to admin
 * This is sent when a sponsorship is cancelled and the child has no active subscriptions
 */
export const sendSponsorshipCancellationNotificationEmail = async (
  childName: string,
  sponsorEmail?: string | null,
  sponsorName?: string | null,
  amount?: number | null,
) => {
  const subject = `Sponsorship Cancelled: ${childName}`
  const formattedAmount = amount ? `$${(amount / 100).toFixed(2)}` : "N/A"

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #fef2f2; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid #dc2626;">
        <h2 style="color: #dc2626; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Sponsorship Cancelled</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">A sponsorship has been cancelled and the child now has no active sponsorships.</p>
        
        <div style="background-color: white; padding: 1rem; border-radius: 0.375rem; margin: 1rem 0;">
          <p style="margin: 0.5rem 0;"><strong>Child:</strong> ${childName}</p>
          <p style="margin: 0.5rem 0;"><strong>Sponsor Name:</strong> ${sponsorName || 'Not provided'}</p>
          <p style="margin: 0.5rem 0;"><strong>Sponsor Email:</strong> ${sponsorEmail || 'Not provided'}</p>
          <p style="margin: 0.5rem 0;"><strong>Amount:</strong> ${formattedAmount}</p>
          <p style="margin: 0.5rem 0; color: #dc2626; font-weight: 600;"><strong>Status:</strong> Child moved to "Sponsorship Cancelled" status</p>
        </div>
        
        <p style="font-size: 1rem; line-height: 1.5; margin-top: 1rem;">
          The child has been moved to "Sponsorship Cancelled" status and can be reinstated to "New" status from the admin panel when ready.
        </p>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `

  return sendEmail({
    to: "johnstjulien@sharetanzania.com",
    subject,
    html,
  })
}
