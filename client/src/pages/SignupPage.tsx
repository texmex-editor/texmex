import React, { useState } from 'react';
import { postApiAuthRegister, type AuthResponse } from '../client';
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from '@/utils/apiError';

type SignupPageProps = {
    onAuthSuccess: (user: AuthResponse) => void;
};

const SignupPage: React.FC<SignupPageProps> = ({ onAuthSuccess }) => {
    const [email, setEmail] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleSignup = async () => {
        try {
            const result = await postApiAuthRegister({ body: { email, displayName, password } });
            if (result.data) {
                setError(null);
                onAuthSuccess(result.data);
            } else {
                // Server now returns a single { status, message } shape (per the
                // unified ProblemDetails writer). getApiErrorMessage handles both
                // the new shape and the legacy { error } / { title, errors } shapes.
                setError(
                    getApiErrorMessage(result.error) ??
                        'Could not create account. Please try again.',
                );
            }
        } catch (e) {
            setError(getApiErrorMessage(e) ?? 'An error occurred during signup.');
        }
    };

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">Sign up</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Sign Up</DialogTitle>
                    <DialogDescription>
                        Create an account to get started.
                    </DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void handleSignup();
                    }}
                >
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="email" className="text-left">
                                Email
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="displayName" className="text-left">
                                Display name
                            </Label>
                            <Input
                                id="displayName"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="password" className="text-left">
                                Password
                            </Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="col-span-3"
                            />
                        </div>
                    </div>
                    {error && (
                        <div className="text-sm text-destructive">
                            <p>{error}</p>
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="submit">Sign up</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default SignupPage;
