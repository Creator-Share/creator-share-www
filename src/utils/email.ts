import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

interface SendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export const sendEmail = async ({ to, subject, text, html }: SendEmailParams) => {
  console.log('Attempting to send email with config:', {
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER ? '✓ Set' : '✗ Not set',
    pass: process.env.EMAIL_PASSWORD ? '✓ Set' : '✗ Not set',
    from: process.env.EMAIL_FROM || '"Creator Share" <noreply@yourapp.com>',
  });

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.error('Email configuration is missing');
    return { success: false, error: 'Email service not configured' };
  }

  try {
    console.log(`Sending email to ${to} with subject: ${subject}`);
    
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"Creator Share" <noreply@yourapp.com>',
      to,
      subject,
      text,
      html,
    });

    console.log('Email sent successfully:', {
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
    });
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email - full details:', error);
    return { success: false, error };
  }
};

export const sendSponsorshipConfirmationEmail = async (
  email: string,
  childName: string,
  amount: number,
  interval: string
) => {
  const subject = `Thank you for sponsoring ${childName}!`;
  
  const formattedAmount = (amount / 100).toFixed(2);
  const intervalText = interval === 'month' ? 'monthly' : 'yearly';
 
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Thank You for Your Sponsorship!</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Dear Sponsor,</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Thank you for your generous contribution of <strong style="color: #1C3C8C;">$${formattedAmount}</strong> ${intervalText} to sponsor ${childName}.</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Your support makes a significant difference in providing education and opportunities for children in need.</p>
      </div>
      
      <div style="border-left: 4px solid #1C3C8C; padding-left: 1rem; margin-bottom: 1.5rem;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.75rem;">We'll keep you updated on ${childName}'s progress and how your sponsorship is making an impact.</p>
        <p style="font-size: 1rem; line-height: 1.5;">If you have any questions about your sponsorship, please don't hesitate to contact us.</p>
      </div>
      
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Warm regards,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to: email,
    subject,
    html,
  });
};

export const sendPaymentFailedEmail = async (
  email: string,
  childName: string,
  amount: number,
  nextAttemptDate: Date | null
) => {
  const subject = `Action Required: Your Sponsorship Payment for ${childName} Failed`;
  
  const formattedAmount = amount.toFixed(2);
  const nextAttemptText = nextAttemptDate 
    ? `We'll automatically try again on ${nextAttemptDate.toLocaleDateString()}.` 
    : "We'll automatically try again soon.";
  
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      
      <div style="background-color: #fef2f2; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem; border-left: 4px solid #dc2626;">
        <h2 style="color: #dc2626; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Payment Failed</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Dear Sponsor,</p>
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
  `;

  return sendEmail({
    to: email,
    subject,
    html,
  });
}; 

export const sendSubscriptionConfirmationEmail = async (
  email: string,
  beneficiaryName: string
) => {
  const subject = `You're subscribed to updates for ${beneficiaryName}!`;
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">Subscription Confirmed!</h2>
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
  `;
  return sendEmail({
    to: email,
    subject,
    html,
  });
};

// Send activity notification email to a subscriber
export const sendActivityNotificationEmail = async (
  email: string,
  beneficiary: { name: string },
  activity: { title: string; description: string }
) => {
  const subject = `New update on ${beneficiary.name}`;
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 1.5rem; border: 1px solid #e5e7eb; border-radius: 0.5rem; color: #1f2937;">
      <div style="text-align: center; margin-bottom: 2rem;">
        <img src="https://creator-share-www.vercel.app/logo_text.svg" alt="Creator Share" style="max-width: 200px; height: auto;" />
      </div>
      <div style="background-color: #f9fafb; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 1.5rem;">
        <h2 style="color: #1C3C8C; font-size: 1.5rem; font-weight: 600; margin-top: 0; text-align: center;">New Update for ${beneficiary.name}</h2>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">Dear Subscriber,</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">A new activity has been posted for <strong>${beneficiary.name}</strong>:</p>
        <p style="font-size: 1.1rem; font-weight: 600; color: #1C3C8C; margin-bottom: 0.5rem;">${activity.title}</p>
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 1rem;">${activity.description}</p>
        <p style="font-size: 1rem; line-height: 1.5;">Visit the site for more details and to see all updates.</p>
      </div>
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 1rem; line-height: 1.5; margin-bottom: 0.25rem;">Thank you for staying connected,</p>
        <p style="font-size: 1rem; line-height: 1.5; font-weight: 600; color: #1C3C8C;">The Creator Share Team</p>
      </div>
      <div style="text-align: center; margin-top: 2rem; font-size: 0.875rem; color: #6b7280;">
        <p>© ${new Date().getFullYear()} Creator Share. All rights reserved.</p>
      </div>
    </div>
  `;
  return sendEmail({
    to: email,
    subject,
    html,
  });
};
