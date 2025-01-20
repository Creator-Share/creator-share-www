import { Text } from '@chakra-ui/react'
import Link from 'next/link'
import React from 'react'

const ToS = () => {
    return (
        <div>
            <Text className='text-[#8D9692] text-xs text-center'>By clicking “Signin or Signup”, you assert that you have read and agreed to our{" "}
                <Link href='#' className="text-[#1C3C8C] hover:underline">Terms of Service</Link> 
                {" "}and{" "}
                <Link href='#' className="text-[#1C3C8C] hover:underline">Privacy Policy.</Link></Text>
        </div>
    )
}

export default ToS